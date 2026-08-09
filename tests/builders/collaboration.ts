import * as Y from 'yjs';

import { importLogicDocument } from '../../src/lib/collaboration/yjs-document-codec';
import type { LogicDocument } from '../../src/lib/document/logic-document';
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
