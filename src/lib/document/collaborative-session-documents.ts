import * as Y from 'yjs';

import { importLogicDocument, readLogicDocument } from '../collaboration/yjs-document-codec';
import { DocumentSessionError } from './document-session';
import type { LogicDocument } from './logic-document';

export function createCollaborativeYDoc(document?: LogicDocument): Y.Doc {
	const ydoc = new Y.Doc();
	if (document !== undefined) importLogicDocument(ydoc, document);
	return ydoc;
}

export function cloneCollaborativeYDoc(document: Y.Doc): Y.Doc {
	const clone = new Y.Doc();
	Y.applyUpdate(clone, Y.encodeStateAsUpdate(document));
	return clone;
}

export function stateVectorsEqual(first: Uint8Array, second: Uint8Array): boolean {
	if (first.byteLength !== second.byteLength) return false;
	return first.every((byte, index) => byte === second[index]);
}

export function readCollaborativeYDoc(document: Y.Doc): LogicDocument {
	const result = readLogicDocument(document);
	if (result.ok) return result.value;
	throw new DocumentSessionError(
		result.diagnostics.map(({ message }) => message).join('; '),
		result.diagnostics,
	);
}
