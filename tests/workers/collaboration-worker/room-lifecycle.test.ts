import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { META_KEY } from '../../../src/lib/infrastructure/collaboration/room-persistence';
import { SessionMessageKind as Message } from '../../../src/lib/infrastructure/collaboration/session-wire';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
} from '../../../src/lib/infrastructure/collaboration/sync-steps';
import { readLogicDocument } from '../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { MAX_ROOM_SOCKETS } from '../../../src/workers/collaboration-worker/collaboration-room';
import worker from '../../../src/workers/collaboration-worker/index';
import {
	archiveKeys,
	restoreArchivedRoom,
} from '../../../src/workers/collaboration-worker/room-archive';
import { roomJournal, roomLabel } from '../../../src/workers/collaboration-worker/room-log';
import { connectRoom, initializeRoom, type RoomClient } from './room-client';

function stub(name: string) {
	return env.COLLABORATION_ROOMS.getByName(name);
}

async function alarmScheduled(name: string): Promise<boolean> {
	return runInDurableObject(stub(name), async (_room, state) => {
		return (await state.storage.getAlarm()) !== null;
	});
}

async function storedCommit(name: string): Promise<number | undefined> {
	return runInDurableObject(stub(name), async (_room, state) => {
		const meta = await state.storage.get<{ commit: number }>(META_KEY);
		return meta?.commit;
	});
}

async function closeAndWaitForAlarm(client: RoomClient, name: string): Promise<void> {
	client.socket.close(1000, 'done');
	await vi.waitFor(async () => {
		expect(await alarmScheduled(name)).toBe(true);
	});
}

async function syncedDocument(client: RoomClient): Promise<Y.Doc> {
	client.send({ type: Message.Sync, payload: writeSyncRequest(new Y.Doc()) });
	const step = readSyncStep((await client.next(Message.Sync)).payload);
	if (step.kind !== SyncStepKind.Response) throw new Error('Expected the room state first');
	const doc = new Y.Doc();
	Y.applyUpdate(doc, step.update);
	return doc;
}

it('refuses a room identifier the client would never produce', async () => {
	const response = await worker.fetch(
		new Request('https://sequit.local/collab/Not%20A%20Room', {
			headers: { upgrade: 'websocket' },
		}),
		env,
	);
	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: 'Malformed room id' });
});

it('refuses the socket beyond the room capacity and journals it', async () => {
	const name = 'crowded-room';
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	const clients = await Promise.all(
		Array.from({ length: MAX_ROOM_SOCKETS }, () => connectRoom(name)),
	);
	const refused = await stub(name).fetch(`https://sequit.local/collab/${name}`, {
		headers: { upgrade: 'websocket' },
	});
	expect(refused.status).toBe(429);
	expect(await refused.json()).toEqual({ error: 'Room full' });
	expect(warn).toHaveBeenCalledWith(
		expect.objectContaining({ event: 'room.full', sockets: MAX_ROOM_SOCKETS }),
	);
	for (const client of clients) client.socket.close(1000, 'done');
	warn.mockRestore();
});

it('archives an idle room to R2, frees its storage, and wakes it up from the archive', async () => {
	const name = 'archived-room';
	const alice = await connectRoom(name);
	const doc = await initializeRoom(name, alice);
	const expected = readLogicDocument(doc);
	expect(await alarmScheduled(name)).toBe(true);
	await closeAndWaitForAlarm(alice, name);

	expect(await runDurableObjectAlarm(stub(name))).toBe(true);
	const keys = archiveKeys(name);
	const state = await env.ROOM_ARCHIVE.get(keys.state);
	const toml = await env.ROOM_ARCHIVE.get(keys.document);
	expect(state?.customMetadata).toMatchObject({ commit: '1' });
	expect(await toml?.text()).toContain(`id = "${name}"`);
	expect(await storedCommit(name)).toBeUndefined();
	expect(await alarmScheduled(name)).toBe(false);

	// The same instance is still in memory: a newcomer must not see an empty room.
	const bob = await connectRoom(name);
	const woken = await syncedDocument(bob);
	expect(readLogicDocument(woken)).toEqual(expected);
	expect(await storedCommit(name)).toBe(1);
	await closeAndWaitForAlarm(bob, name);

	// After a real eviction, the constructor restores from the archive as well.
	expect(await runDurableObjectAlarm(stub(name))).toBe(true);
	await evictDurableObject(stub(name));
	const carol = await connectRoom(name);
	expect(readLogicDocument(await syncedDocument(carol))).toEqual(expected);
	carol.socket.close(1000, 'done');
});

it('keeps a room hot while a participant is connected', async () => {
	const name = 'busy-room';
	const alice = await connectRoom(name);
	await initializeRoom(name, alice);
	expect(await runDurableObjectAlarm(stub(name))).toBe(true);
	expect(await storedCommit(name)).toBe(1);
	expect(await alarmScheduled(name)).toBe(true);
	expect(await env.ROOM_ARCHIVE.get(archiveKeys(name).state)).toBeNull();
	alice.socket.close(1000, 'done');
});

it('forgets a room that was never initialized without archiving anything', async () => {
	const name = 'empty-room';
	const alice = await connectRoom(name);
	await closeAndWaitForAlarm(alice, name);
	expect(await runDurableObjectAlarm(stub(name))).toBe(true);
	expect(await env.ROOM_ARCHIVE.get(archiveKeys(name).state)).toBeNull();
	expect(await alarmScheduled(name)).toBe(false);
});

it('keeps the hot storage when the archive upload fails, and retries later', async () => {
	const name = 'archive-outage';
	const alice = await connectRoom(name);
	await initializeRoom(name, alice);
	await closeAndWaitForAlarm(alice, name);
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const put = vi.spyOn(env.ROOM_ARCHIVE, 'put').mockRejectedValueOnce(new Error('R2 down'));
	await expect(runDurableObjectAlarm(stub(name))).rejects.toThrow('R2 down');
	expect(await storedCommit(name)).toBe(1);
	expect(error).toHaveBeenCalledWith(
		expect.objectContaining({ event: 'room.archive-failed', error: 'R2 down' }),
	);
	put.mockRestore();
	error.mockRestore();
});

it('never lets a damaged archive into the hot storage', async () => {
	const name = 'damaged-archive';
	const keys = archiveKeys(name);
	await env.ROOM_ARCHIVE.put(keys.state, new Uint8Array([1, 2, 3]), {
		customMetadata: { commit: '3' },
	});
	await runInDurableObject(stub(name), async (_room, state) => {
		await expect(restoreArchivedRoom(env.ROOM_ARCHIVE, state.storage, name)).rejects.toThrow(
			'invalid',
		);
		expect(await state.storage.get(META_KEY)).toBeUndefined();
	});
	await env.ROOM_ARCHIVE.put(keys.state, new Uint8Array([1, 2, 3]), {
		customMetadata: { commit: 'soon' },
	});
	await runInDurableObject(stub(name), async (_room, state) => {
		await expect(restoreArchivedRoom(env.ROOM_ARCHIVE, state.storage, name)).rejects.toThrow(
			'metadata',
		);
	});
});

it('journals under a stable label that never reveals the room secret', async () => {
	const label = await roomLabel('secret-room-1234567890');
	expect(label).toMatch(/^[0-9a-f]{12}$/);
	expect(await roomLabel('secret-room-1234567890')).toBe(label);
	expect(await roomLabel(undefined)).toBe('anonymous');
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
	roomJournal(label).info('connected', { sockets: 1 });
	expect(info).toHaveBeenCalledWith({ event: 'room.connected', room: label, sockets: 1 });
	info.mockRestore();
});
