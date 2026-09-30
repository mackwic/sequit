import type * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import { readLogicDocument, type YjsLiveDocumentResult } from './yjs-document-codec';

export type YjsDocumentRepositoryObserver = (
	result: YjsLiveDocumentResult<LogicDocument>,
	origin: unknown,
	revision: number,
) => void;

/** Decodes the physical Y.Doc after every transaction; writes go through the shared executor. */
export class YjsDocumentRepository {
	readonly #observers = new Set<YjsDocumentRepositoryObserver>();
	#lastValidDocument: LogicDocument | undefined;
	#lastPhysicalResult: YjsLiveDocumentResult<LogicDocument>;
	#revision = 0;

	constructor(readonly document: Y.Doc) {
		document.on('afterTransaction', this.#afterTransaction);
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

	observe(observer: YjsDocumentRepositoryObserver): () => void {
		this.#observers.add(observer);
		return () => this.#observers.delete(observer);
	}

	destroy(): void {
		this.document.off('afterTransaction', this.#afterTransaction);
		this.#observers.clear();
		this.#lastValidDocument = undefined;
	}

	readonly #afterTransaction = (transaction: Y.Transaction): void => {
		const revision = ++this.#revision;
		const result = this.read();
		this.#lastPhysicalResult = result;
		if (result.ok) this.#lastValidDocument = result.value;
		for (const observer of [...this.#observers]) {
			try {
				observer(result, transaction.origin, revision);
			} catch {
				// Repository observers cannot interrupt Yjs transaction delivery.
			}
		}
	};
}
