import * as Y from 'yjs';

import { defined, type LogicDocument } from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';
import type { DocumentChangeResult } from '../document/document-command-contracts';
import { reconcileYjsDocument } from './reconcile-yjs-document';
import { spliceSharedText } from './shared-text';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import {
	applyYjsDocumentChanges,
	type MarkdownTarget,
	markdownTarget,
	validateYjsAdditionConflicts,
	YjsDocumentRepositoryRejection,
} from './yjs-document-mutations';
import { isMarkdownOnly, projectYjsDocumentChange } from './yjs-document-projection';
import { YjsCollection } from './yjs-document-schema';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
	revision: number,
) => void;

const NODES = YjsCollection.Nodes;
const REPLACE_MARKDOWN_ORIGIN = Symbol('sequit replace node markdown');

export function replaceNodeMarkdown(
	document: Y.Doc,
	nodeId: string,
	markdown: string,
	origin: unknown = REPLACE_MARKDOWN_ORIGIN,
): boolean {
	const text = document.getMap<Y.Map<unknown>>(NODES).get(nodeId)?.get('markdown');
	if (!(text instanceof Y.Text)) return false;
	document.transact(() => {
		spliceSharedText(text, markdown);
	}, origin);
	return true;
}

interface PersistenceCapture {
	result: DocumentChangeResult | undefined;
	projected: LogicDocument | undefined;
	markdownOnly: boolean;
	targets: readonly MarkdownTarget[];
	recovery: boolean;
}

interface MarkdownTargetCapture {
	readonly targets: readonly MarkdownTarget[];
}

interface MarkdownTargetFailure {
	readonly failure: DocumentChangeResult;
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
	readonly #checkpointedTransactions = new WeakSet<Y.Transaction>();
	#persistenceCapture: PersistenceCapture | undefined;
	#lastValidDocument: LogicDocument | undefined;
	#lastPhysicalResult: YjsLiveDocumentResult<LogicDocument>;
	#checkpointDocument: Y.Doc | undefined;
	#canRecoverFromLastValid = false;
	#physicalValid = false;
	#revision = 0;
	#acceptedRevision = 0;

	constructor(readonly document: Y.Doc) {
		document.on('afterTransaction', this.#afterTransaction);
		document.on('update', this.#afterUpdate);
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
		try {
			for (const { nodeId } of changes.nodeMarkdownReplacements)
				markdownTarget(this.document, nodeId);
		} catch (error) {
			if (error instanceof YjsDocumentRepositoryRejection)
				return { ok: false, diagnostics: error.diagnostics };
			throw error;
		}
		return this.#lastPhysicalResult;
	}

	#captureMarkdownTargets(
		changes: DocumentChangeSet,
		document: Y.Doc,
	): MarkdownTargetCapture | MarkdownTargetFailure {
		try {
			const targets = changes.nodeMarkdownReplacements.map(({ nodeId }) =>
				markdownTarget(document, nodeId),
			);
			return { targets };
		} catch (error) {
			if (error instanceof YjsDocumentRepositoryRejection)
				return { failure: { ok: false, diagnostics: error.diagnostics } };
			throw error;
		}
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
			let current: MarkdownTarget;
			try {
				current = markdownTarget(this.document, target.nodeId);
			} catch (error) {
				if (error instanceof YjsDocumentRepositoryRejection)
					return { ok: false, diagnostics: error.diagnostics };
				throw error;
			}
			if (current.node !== target.node || current.text !== target.text)
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
		this.document.off('afterTransaction', this.#afterTransaction);
		this.document.off('update', this.#afterUpdate);
		this.#observers.clear();
		this.#checkpointDocument?.destroy();
		this.#lastValidDocument = undefined;
	}

	readonly #afterUpdate = (
		update: Uint8Array,
		_origin: unknown,
		_document: Y.Doc,
		transaction: Y.Transaction,
	): void => {
		if (!this.#validTransactions.has(transaction)) return;
		const checkpoint = this.#checkpointDocument;
		if (checkpoint !== undefined && !this.#checkpointedTransactions.has(transaction))
			Y.applyUpdate(checkpoint, update);
	};

	#matchesMarkdownTransaction(
		transaction: Y.Transaction,
		capture: PersistenceCapture,
		expected: LogicDocument,
	): boolean {
		const targets = new Map(
			capture.targets.map(({ nodeId, node, text }) => [text, { nodeId, node }]),
		);
		const targetTypes = new Set<unknown>(targets.keys());
		for (const changed of transaction.changed.keys()) if (!targetTypes.has(changed)) return false;
		const nodes = this.document.getMap<Y.Map<unknown>>(NODES);
		for (const [text, { nodeId, node }] of targets) {
			if (nodes.get(nodeId) !== node || node.get('markdown') !== text) return false;
			if (text.toJSON() !== expected.nodes.find(({ id }) => id === nodeId)?.markdown) return false;
		}
		return true;
	}

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
			if (wasInvalid) {
				this.#checkpointDocument?.destroy();
				this.#checkpointDocument = this.#clone(this.document);
				this.#checkpointedTransactions.add(transaction);
			} else this.#validTransactions.add(transaction);
		} else {
			this.#physicalValid = false;
			const external = !transaction.local;
			this.#canRecoverFromLastValid = external && this.#persistenceCapture === undefined;
		}
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const revision = ++this.#revision;
		const capture = this.#persistenceCapture;
		const projection = capture?.projected;
		if (capture !== undefined) capture.projected = undefined;
		let result: YjsLiveDocumentResult<LogicDocument>;
		const validFastPath = projection !== undefined && capture?.markdownOnly === true;
		const matches =
			validFastPath && this.#matchesMarkdownTransaction(transaction, capture, projection);
		if (!matches || capture.recovery) result = this.read();
		else result = { ok: true, value: projection };
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
