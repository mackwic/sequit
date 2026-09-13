import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import type * as Y from 'yjs';

export enum SyncStepKind {
	Request = 'request',
	Response = 'response',
}

interface SyncRequest {
	readonly kind: SyncStepKind.Request;
	readonly stateVector: Uint8Array;
}

interface SyncResponse {
	readonly kind: SyncStepKind.Response;
	readonly update: Uint8Array;
}

export type SyncStep = SyncRequest | SyncResponse;

export function writeSyncRequest(document: Y.Doc): Uint8Array {
	const encoder = encoding.createEncoder();
	sync.writeSyncStep1(encoder, document);
	return encoding.toUint8Array(encoder);
}

export function writeSyncResponse(document: Y.Doc, stateVector?: Uint8Array): Uint8Array {
	const encoder = encoding.createEncoder();
	sync.writeSyncStep2(encoder, document, stateVector);
	return encoding.toUint8Array(encoder);
}

/** Decode without applying: the server validates SyncStep2 before mutating accepted state. */
export function readSyncStep(bytes: Uint8Array): SyncStep {
	const decoder = decoding.createDecoder(bytes);
	const kind = decoding.readVarUint(decoder);
	const payload = decoding.readVarUint8Array(decoder);
	if (decoding.hasContent(decoder)) throw new Error('Trailing sync data');
	if (kind === sync.messageYjsSyncStep1)
		return { kind: SyncStepKind.Request, stateVector: payload };
	if (kind === sync.messageYjsSyncStep2) return { kind: SyncStepKind.Response, update: payload };
	throw new Error('Expected SyncStep1 or SyncStep2');
}
