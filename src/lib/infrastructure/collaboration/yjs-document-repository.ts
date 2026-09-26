import * as Y from 'yjs';

import { defined, type LogicDocument } from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';
import type { DocumentChangeResult } from '../document/document-command-contracts';
import { reconcileYjsDocument } from './reconcile-yjs-document';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import {
	applyYjsDocumentChanges,
	lookupMarkdownTarget,
	type MarkdownTarget,
	type MarkdownTargetFailure,
	validateYjsAdditionConflicts,
} from './yjs-document-mutations';
import { isMarkdownOnly, projectYjsDocumentChange } from './yjs-document-projection';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
	revision: number,
) => void;

interface PersistenceCapture {
	result: DocumentChangeResult | undefined;
	projected: LogicDocument | undefined;
	markdownOnly: boolean;
	targets: readonly MarkdownTarget[];
	recovery: boolean;
	transaction?: Y.Transaction;
	secondaryTransactions: boolean;
}

interface MarkdownTargetCapture {
	readonly targets: readonly MarkdownTarget[];
}

interface PersistencePlan {
	readonly changes: DocumentChangeSet;
	readonly projection: LogicDocument;
	readonly targets: readonly MarkdownTarget[];
	readonly checkpoint: Y.Doc | undefined;
	readonly recovering: boolean;
	readonly origin: unknown;
}

interface GuardedPersistencePlan extends PersistencePlan {
	readonly validationRevision: number;
}

export class YjsDocumentRepository {
	readonly #observers = new Set<YjsDocumentRepositoryObserver>();
	readonly #validTransactions = new WeakSet<Y.Transaction>();
	readonly #activeTransactions = new Set<Y.Transaction>();
	#persistenceCapture: PersistenceCapture | undefined;
	#lastValidDocument: LogicDocument | undefined;
	#lastPhysicalResult: YjsLiveDocumentResult<LogicDocument>;
	#checkpointDocument: Y.Doc | undefined;
	#canRecoverFromLastValid = false;
	#recoveryConflict = false;
	#physicalValid = false;
	#revision = 0;
	#acceptedRevision = 0;

	constructor(readonly document: Y.Doc) {
		document.on('beforeTransaction', this.#beforeTransaction);
		document.on('afterTransaction', this.#afterTransaction);
		document.on('update', this.#afterUpdate);
		document.on('afterAllTransactions', this.#afterAllTransactions);
		const initial = readLogicDocument(document);
		this.#lastPhysicalResult = initial;
		if (initial.ok) {
			this.#lastValidDocument = initial.value;
			this.#checkpointDocument = this.#clone(document);
			this.#physicalValid = true;
		}
	}

	read(): YjsLiveDocumentResult<LogicDocument> {
		return readLogicDocument(this.document);
	}

	readAccepted(): YjsLiveDocumentResult<LogicDocument> {
		const accepted = this.#lastValidDocument;
		if (accepted !== undefined) return { ok: true, value: accepted };
		return this.#lastPhysicalResult;
	}

	get acceptedRevision(): number {
		return this.#acceptedRevision;
	}

	persist(changes: DocumentChangeSet, origin?: unknown): Promise<DocumentChangeResult> {
		if (this.#persistenceCapture !== undefined || this.#activeTransactions.size > 0)
			return Promise.resolve({
				ok: false,
				diagnostics: [
					{
						code: 'document-command-reentrant',
						message: 'A document command is already in progress',
						path: [],
					},
				],
			});
		return Promise.resolve(this.#persist(changes, origin));
	}

	#persist(changes: DocumentChangeSet, origin?: unknown): DocumentChangeResult {
		const checkpoint = this.#checkpointDocument;
		const allowedRecovery = !this.#physicalValid && this.#canRecoverFromLastValid;
		const recovering = allowedRecovery && checkpoint !== undefined;
		const accepted = this.#lastValidDocument;
		if (accepted === undefined) return this.#lastPhysicalResult;
		if (!this.#physicalValid && !recovering) return this.#invalidPhysicalFailure(changes);
		let targetSource = this.document;
		if (recovering) targetSource = defined(checkpoint);
		const targetCapture = this.#captureMarkdownTargets(changes, targetSource);
		if ('failure' in targetCapture) return targetCapture.failure;
		let targets: readonly MarkdownTarget[] = [];
		if (!recovering) targets = targetCapture.targets;
		const projection = projectYjsDocumentChange(accepted, changes);
		if (!projection.ok) return projection;
		return this.#commitProjection({
			changes,
			projection: projection.value,
			targets,
			checkpoint,
			recovering,
			origin,
		});
	}

	#invalidPhysicalFailure(changes: DocumentChangeSet): DocumentChangeResult {
		if (this.#recoveryConflict)
			return {
				ok: false,
				diagnostics: [
					{
						code: 'recovery-conflict',
						message:
							'Further updates arrived while the document was invalid; automatic recovery would discard them',
						path: [],
					},
				],
			};
		for (const { nodeId } of changes.nodeMarkdownReplacements) {
			const result = lookupMarkdownTarget(this.document, nodeId);
			if ('failure' in result) return result.failure;
		}
		return this.#lastPhysicalResult;
	}

	#captureMarkdownTargets(
		changes: DocumentChangeSet,
		document: Y.Doc,
	): MarkdownTargetCapture | MarkdownTargetFailure {
		const targets: MarkdownTarget[] = [];
		for (const { nodeId } of changes.nodeMarkdownReplacements) {
			const result = lookupMarkdownTarget(document, nodeId);
			if ('failure' in result) return result;
			targets.push(result.target);
		}
		return { targets };
	}

	#commitProjection(plan: PersistencePlan): DocumentChangeResult {
		const guardedPlan: GuardedPersistencePlan = {
			...plan,
			validationRevision: this.#revision,
		};
		const capture: PersistenceCapture = {
			result: undefined,
			projected: undefined,
			markdownOnly: isMarkdownOnly(plan.changes),
			targets: plan.targets,
			recovery: plan.recovering,
			secondaryTransactions: false,
		};
		let transactionChangedBeforeCommand = false;
		const inspectBeforeTransaction = (transaction: Y.Transaction) => {
			transactionChangedBeforeCommand = transaction.changed.size > 0;
		};
		this.document.on('beforeTransaction', inspectBeforeTransaction);
		this.#persistenceCapture = capture;
		try {
			this.document.transact(() => {
				this.#applyProjection(capture, guardedPlan, transactionChangedBeforeCommand);
			}, plan.origin);
			const commandResult = defined(capture.result);
			if (!commandResult.ok) return commandResult;
			const physicalResult = this.#lastPhysicalResult;
			if (!physicalResult.ok) return physicalResult;
			return { ok: true, value: defined(this.#lastValidDocument) };
		} finally {
			this.document.off('beforeTransaction', inspectBeforeTransaction);
			this.#persistenceCapture = undefined;
		}
	}

	#applyProjection(
		capture: PersistenceCapture,
		plan: GuardedPersistencePlan,
		transactionChangedBeforeCommand: boolean,
	): void {
		if (!plan.recovering) {
			const targetFailure = this.#targetFailure(plan.targets);
			if (targetFailure !== undefined) {
				capture.result = targetFailure;
				return;
			}
		}
		if (!plan.recovering && transactionChangedBeforeCommand)
			validateYjsAdditionConflicts(this.document, plan.changes);
		const revisionChanged = this.#revision !== plan.validationRevision;
		if (revisionChanged || transactionChangedBeforeCommand) {
			capture.result = this.#staleTargetFailure();
			return;
		}
		capture.result = { ok: true, value: plan.projection };
		if (plan.recovering) reconcileYjsDocument(this.document, defined(plan.checkpoint));
		else capture.projected = plan.projection;
		try {
			applyYjsDocumentChanges(this.document, plan.changes);
		} catch (error) {
			capture.projected = undefined;
			throw error;
		}
	}

	#targetFailure(targets: readonly MarkdownTarget[]): DocumentChangeResult | undefined {
		for (const target of targets) {
			const result = lookupMarkdownTarget(this.document, target.nodeId);
			if ('failure' in result) return result.failure;
			if (result.target.node !== target.node || result.target.text !== target.text)
				return this.#staleTargetFailure();
		}
		return undefined;
	}

	#staleTargetFailure(): DocumentChangeResult {
		return {
			ok: false,
			diagnostics: [
				{
					code: 'document-changed-during-command',
					message: 'The document changed before the command could be applied',
					path: [],
				},
			],
		};
	}

	#clone(source: Y.Doc): Y.Doc {
		const clone = new Y.Doc({ gc: false });
		Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
		return clone;
	}

	observe(observer: YjsDocumentRepositoryObserver): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}

	destroy(): void {
		this.document.off('beforeTransaction', this.#beforeTransaction);
		this.document.off('afterTransaction', this.#afterTransaction);
		this.document.off('update', this.#afterUpdate);
		this.document.off('afterAllTransactions', this.#afterAllTransactions);
		this.#observers.clear();
		this.#checkpointDocument?.destroy();
		this.#lastValidDocument = undefined;
	}

	readonly #beforeTransaction = (transaction: Y.Transaction): void => {
		this.#activeTransactions.add(transaction);
		const capture = this.#persistenceCapture;
		if (capture === undefined || capture.transaction === transaction) return;
		if (capture.transaction === undefined) capture.transaction = transaction;
		else capture.secondaryTransactions = true;
	};

	readonly #afterAllTransactions = (): void => {
		this.#activeTransactions.clear();
	};

	readonly #afterUpdate = (
		update: Uint8Array,
		_origin: unknown,
		_document: Y.Doc,
		transaction: Y.Transaction,
	): void => {
		if (!this.#validTransactions.has(transaction)) return;
		Y.applyUpdate(defined(this.#checkpointDocument), update);
	};

	#recordPhysicalResult(
		result: YjsLiveDocumentResult<LogicDocument>,
		transaction: Y.Transaction,
		revision: number,
	): void {
		this.#lastPhysicalResult = result;
		if (result.ok) {
			const wasInvalid = !this.#physicalValid;
			this.#lastValidDocument = result.value;
			this.#acceptedRevision = revision;
			this.#physicalValid = true;
			this.#canRecoverFromLastValid = false;
			this.#recoveryConflict = false;
			if (wasInvalid) {
				this.#checkpointDocument?.destroy();
				this.#checkpointDocument = this.#clone(this.document);
			} else this.#validTransactions.add(transaction);
		} else {
			if (!this.#physicalValid && this.#lastValidDocument !== undefined)
				this.#recoveryConflict = true;
			this.#physicalValid = false;
			const external = !transaction.local;
			const capture = this.#persistenceCapture;
			const noConflict = !this.#recoveryConflict;
			const otherTransaction = capture?.transaction !== transaction;
			this.#canRecoverFromLastValid = external && noConflict && otherTransaction;
		}
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const revision = ++this.#revision;
		const active = this.#persistenceCapture;
		let capture = active;
		if (active?.transaction !== transaction) capture = undefined;
		const projection = capture?.projected;
		if (capture !== undefined) capture.projected = undefined;
		let result: YjsLiveDocumentResult<LogicDocument>;
		const markdownProjection = projection !== undefined && capture?.markdownOnly === true;
		const stableTransaction = capture?.secondaryTransactions === false;
		const useProjection = markdownProjection && stableTransaction;
		if (useProjection) result = { ok: true, value: projection };
		else result = this.read();
		this.#recordPhysicalResult(result, transaction, revision);
		const applied = projection !== undefined || capture?.recovery === true;
		if (capture !== undefined && applied) capture.result = result;
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin, revision);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
			}
		}
	};
}
