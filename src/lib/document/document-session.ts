import * as Y from 'yjs';

import {
	importLogicDocument,
	readLogicDocument,
	replaceNodeMarkdown,
} from '../collaboration/yjs-live-document';
import type { LogicDocument } from './logic-document';

interface DocumentSessionDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly path: readonly string[];
}

type DocumentSessionResult =
	| { readonly ok: true; readonly value: LogicDocument }
	| { readonly ok: false; readonly diagnostics: readonly DocumentSessionDiagnostic[] };

export interface DocumentSession {
	read(): DocumentSessionResult;
	subscribe(listener: () => void): () => void;
	replaceNodeMarkdown(nodeId: string, markdown: string): boolean;
	destroy(): void;
}

export function createDocumentSession(document: LogicDocument): DocumentSession {
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, document);
	const listeners = new Set<() => void>();
	let destroyed = false;
	const notify = () => {
		for (const listener of listeners) listener();
	};
	ydoc.on('update', notify);

	return {
		read() {
			return readLogicDocument(ydoc);
		},
		subscribe(listener) {
			if (destroyed) return () => undefined;
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		replaceNodeMarkdown(nodeId, markdown) {
			return !destroyed && replaceNodeMarkdown(ydoc, nodeId, markdown);
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			ydoc.off('update', notify);
			listeners.clear();
			ydoc.destroy();
		},
	};
}
