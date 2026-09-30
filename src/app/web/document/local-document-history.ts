import * as Y from 'yjs';

import { YjsCollection } from '../../../lib/infrastructure/collaboration/yjs-document-schema';
import type {
	DocumentHistory,
	DocumentHistoryAvailability,
} from '../../../lib/infrastructure/document/document-session-contracts';

const STACK_EVENTS = [
	'stack-item-added',
	'stack-item-popped',
	'stack-item-updated',
	'stack-cleared',
] as const;

/**
 * Every transaction with a tracked origin is its own step: a command batch is applied in one
 * transaction and a text save is one splice, so no capture window merges them. Undo and redo
 * transact with the manager as origin, which the session publishes like any other transaction.
 */
export class LocalDocumentHistory implements DocumentHistory {
	readonly #manager: Y.UndoManager;
	readonly #listeners = new Set<(availability: DocumentHistoryAvailability) => void>();
	readonly #notify = (): void => {
		const availability = this.availability();
		for (const listener of [...this.#listeners]) listener(availability);
	};

	constructor(document: Y.Doc, trackedOrigins: readonly symbol[]) {
		this.#manager = new Y.UndoManager(
			Object.values(YjsCollection).map((name) => document.getMap(name)),
			{ captureTimeout: 0, trackedOrigins: new Set<unknown>(trackedOrigins) },
		);
		for (const event of STACK_EVENTS) this.#manager.on(event, this.#notify);
	}

	availability(): DocumentHistoryAvailability {
		return { undo: this.#manager.canUndo(), redo: this.#manager.canRedo() };
	}

	subscribe(listener: (availability: DocumentHistoryAvailability) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** An empty undo still opens a transaction that the session would republish: check first. */
	undo(): boolean {
		return this.#manager.canUndo() && this.#manager.undo() !== null;
	}

	redo(): boolean {
		return this.#manager.canRedo() && this.#manager.redo() !== null;
	}

	destroy(): void {
		for (const event of STACK_EVENTS) this.#manager.off(event, this.#notify);
		this.#listeners.clear();
		this.#manager.destroy();
	}
}
