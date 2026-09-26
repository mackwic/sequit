import type * as Y from 'yjs';

import { defined, type LogicDocument } from '../../core/document/logic-document';
import type { DocumentChangeSet } from '../../core/document/topology-edits';
import type { DocumentChangeResult } from '../document/document-command-contracts';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';
import {
	applyYjsDocumentChanges,
	lookupMarkdownTarget,
	type MarkdownTarget,
	type MarkdownTargetFailure,
	validateYjsAdditionConflicts,
	YjsDocumentRepositoryRejection,
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
	readonly origin: unknown;
}

export class YjsDocumentRepository {
	readonly #observers = new Set<YjsDocumentRepositoryObserver>();
	readonly #activeTransactions = new Set<Y.Transaction>();
	#persistenceCapture: PersistenceCapture | undefined;
	#lastValidDocument: LogicDocument | undefined;
	#lastPhysicalResult: YjsLiveDocumentResult<LogicDocument>;
	#revision = 0;

	constructor(readonly document: Y.Doc) {
		document.on('beforeTransaction', this.#beforeTransaction);
		document.on('afterTransaction', this.#afterTransaction);
		document.on('afterAllTransactions', this.#afterAllTransactions);
		const initial = readLogicDocument(document);
		this.#lastPhysicalResult = initial;
		if (initial.ok) this.#lastValidDocument = initial.value;
	}

	read(): YjsLiveDocumentResult<LogicDocument> {
		return readLogicDocument(this.document);
	}

	readAccepted(): YjsLiveDocumentResult<LogicDocument> {
		const accepted = this.#lastValidDocument;
		if (accepted !== undefined) return { ok: true, value: accepted };
		return this.#lastPhysicalResult;
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
		try {
			return Promise.resolve(this.#persist(changes, origin));
		} catch (error) {
			if (error instanceof YjsDocumentRepositoryRejection)
				return Promise.resolve({ ok: false, diagnostics: error.diagnostics });
			let message = String(error);
			if (error instanceof Error) message = error.message;
			return Promise.resolve({
				ok: false,
				diagnostics: [{ code: 'document-command-invalid', message, path: [] }],
			});
		}
	}

	#persist(changes: DocumentChangeSet, origin?: unknown): DocumentChangeResult {
		if (!this.#lastPhysicalResult.ok) return this.#invalidPhysicalFailure(changes);
		const targetCapture = this.#captureMarkdownTargets(changes);
		if ('failure' in targetCapture) return targetCapture.failure;
		const projection = projectYjsDocumentChange(this.#lastPhysicalResult.value, changes);
		if (!projection.ok) return projection;
		return this.#commitProjection({
			changes,
			projection: projection.value,
			targets: targetCapture.targets,
			origin,
		});
	}

	#invalidPhysicalFailure(changes: DocumentChangeSet): DocumentChangeResult {
		if (this.#lastValidDocument === undefined) return this.#lastPhysicalResult;
		for (const { nodeId } of changes.nodeMarkdownReplacements) {
			const result = lookupMarkdownTarget(this.document, nodeId);
			if ('failure' in result) return result.failure;
		}
		return this.#lastPhysicalResult;
	}

	#captureMarkdownTargets(
		changes: DocumentChangeSet,
	): MarkdownTargetCapture | MarkdownTargetFailure {
		const targets: MarkdownTarget[] = [];
		for (const { nodeId } of changes.nodeMarkdownReplacements) {
			const result = lookupMarkdownTarget(this.document, nodeId);
			if ('failure' in result) return result;
			targets.push(result.target);
		}
		return { targets };
	}

	#commitProjection(plan: PersistencePlan): DocumentChangeResult {
		const capture: PersistenceCapture = {
			result: undefined,
			projected: undefined,
			markdownOnly: isMarkdownOnly(plan.changes),
			targets: plan.targets,
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
				this.#applyProjection(capture, plan, transactionChangedBeforeCommand);
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
		plan: PersistencePlan,
		transactionChangedBeforeCommand: boolean,
	): void {
		const targetFailure = this.#targetFailure(plan.targets);
		if (targetFailure !== undefined) {
			capture.result = targetFailure;
			return;
		}
		if (transactionChangedBeforeCommand) {
			validateYjsAdditionConflicts(this.document, plan.changes);
			capture.result = this.#staleTargetFailure();
			return;
		}
		capture.result = { ok: true, value: plan.projection };
		capture.projected = plan.projection;
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

	observe(observer: YjsDocumentRepositoryObserver): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}

	destroy(): void {
		this.document.off('beforeTransaction', this.#beforeTransaction);
		this.document.off('afterTransaction', this.#afterTransaction);
		this.document.off('afterAllTransactions', this.#afterAllTransactions);
		this.#observers.clear();
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
		this.#lastPhysicalResult = result;
		if (result.ok) this.#lastValidDocument = result.value;
		if (capture !== undefined && projection !== undefined) capture.result = result;
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin, revision);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
			}
		}
	};
}
