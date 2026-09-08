import * as Y from 'yjs';

import type { LogicDocument } from '../../core/document/logic-document';
import { DocumentSessionError } from '../document/document-session-contracts';
import { importLogicDocument, readLogicDocument } from './yjs-document-codec';

interface AuthoritativeUpdate {
	readonly update: Uint8Array;
	readonly stateVector: Uint8Array;
}

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

export function applyAuthoritativeUpdate(
	document: Y.Doc,
	message: AuthoritativeUpdate,
): Y.Doc | undefined {
	try {
		Y.applyUpdate(document, message.update);
		if (!stateVectorsEqual(Y.encodeStateVector(document), message.stateVector)) {
			throw new Error('Authoritative state vector does not match the applied update');
		}
		readCollaborativeYDoc(document);
		return document;
	} catch {
		document.destroy();
		return undefined;
	}
}

export function isValidEmptyRoomUpdate(message: AuthoritativeUpdate): boolean {
	const empty = new Y.Doc();
	const emptyStateVector = Y.encodeStateVector(empty);
	try {
		Y.applyUpdate(empty, message.update);
		const receivedStateVector = Y.encodeStateVector(empty);
		return (
			stateVectorsEqual(receivedStateVector, emptyStateVector) &&
			stateVectorsEqual(receivedStateVector, message.stateVector)
		);
	} catch {
		return false;
	} finally {
		empty.destroy();
	}
}

export function readCollaborativeYDoc(document: Y.Doc): LogicDocument {
	const result = readLogicDocument(document);
	if (result.ok) return result.value;
	throw new DocumentSessionError(
		result.diagnostics.map(({ message }) => message).join('; '),
		result.diagnostics,
	);
}
