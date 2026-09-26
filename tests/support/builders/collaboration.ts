import * as Y from 'yjs';

import type { LogicDocument } from '../../../src/lib/core/document/logic-document';
import { importLogicDocument } from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { validLogicDocument } from './logic-document';

export function collaborativeDocument(roomId: string): LogicDocument {
	return { ...validLogicDocument(), id: roomId, title: `Collaborative document ${roomId}` };
}

export function encodeFullUpdate(document: LogicDocument): Uint8Array {
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, document);
		return Y.encodeStateAsUpdate(ydoc);
	} finally {
		ydoc.destroy();
	}
}

export function proposeChange(
	authoritative: Y.Doc,
	mutate: (candidate: Y.Doc) => void,
): Uint8Array {
	const candidate = new Y.Doc();
	try {
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(authoritative));
		const before = Y.encodeStateVector(authoritative);
		mutate(candidate);
		return Y.encodeStateAsUpdate(candidate, before);
	} finally {
		candidate.destroy();
	}
}

export function replaceSharedNodeMarkdown(document: Y.Doc, nodeId: string, markdown: string): void {
	const text = document.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get(nodeId)?.get('markdown');
	if (!(text instanceof Y.Text)) throw new Error(`Expected shared Markdown on ${nodeId}`);
	document.transact(() => {
		text.delete(0, text.length);
		text.insert(0, markdown);
	});
}
