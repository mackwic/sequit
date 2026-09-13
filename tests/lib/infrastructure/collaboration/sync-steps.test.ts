import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as sync from 'y-protocols/sync';
import * as Y from 'yjs';

import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../../../src/lib/infrastructure/collaboration/sync-steps';

describe('y-protocols sync envelope', () => {
	it('uses the native two steps and exposes the update for validation before applying it', () => {
		const server = new Y.Doc();
		server.getText('text').insert(0, 'Alpha');
		const client = new Y.Doc();
		const step1 = writeSyncRequest(client);
		const request = readSyncStep(step1);
		if (request.kind !== SyncStepKind.Request) throw new Error('Expected first step');
		const nativeReply = encoding.createEncoder();
		const decoder = decoding.createDecoder(step1);
		expect(decoding.readVarUint(decoder)).toBe(sync.messageYjsSyncStep1);
		sync.readSyncStep1(decoder, nativeReply, server);
		const step2 = writeSyncResponse(server, request.stateVector);
		expect(step2).toEqual(encoding.toUint8Array(nativeReply));
		const response = readSyncStep(step2);
		if (response.kind !== SyncStepKind.Response) throw new Error('Expected second step');
		expect(client.getText('text').toJSON()).toBe('');
		Y.applyUpdate(client, response.update);
		expect(client.getText('text').toJSON()).toBe('Alpha');
		server.destroy();
		client.destroy();
	});

	it('does not accept a regular update as a sync step or ignore trailing bytes', () => {
		const encoder = encoding.createEncoder();
		sync.writeUpdate(encoder, new Uint8Array([0, 0]));
		expect(() => readSyncStep(encoding.toUint8Array(encoder))).toThrow('Expected SyncStep');
		const document = new Y.Doc();
		const bytes = writeSyncRequest(document);
		expect(() => readSyncStep(new Uint8Array([...bytes, 0]))).toThrow('Trailing sync');
		expect(() => readSyncStep(new Uint8Array())).toThrow();
		document.destroy();
	});
});
