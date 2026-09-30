import * as Y from 'yjs';

import {
	chunkKeys,
	planPersistence,
	splitChunks,
} from '../../lib/infrastructure/collaboration/room-persistence';
import { readLogicDocument } from '../../lib/infrastructure/collaboration/yjs-document-codec';
import { serializeSequitToml } from '../../lib/infrastructure/toml/serialize-sequit-toml';
import type { RoomJournal } from './room-log';
import {
	decodeStoredRoomState,
	persistRoomState,
	restoreRoomState,
	type RoomState,
} from './room-storage';

/** A room without any participant for this long leaves the Durable Object for the archive. */
export const IDLE_BEFORE_ARCHIVE_MS = 24 * 60 * 60 * 1000;

const COMMIT_METADATA = 'commit';

/** The Yjs state is what a room restores from; the TOML beside it is for people and exports. */
export function archiveKeys(roomId: string): { readonly state: string; readonly document: string } {
	return { state: `rooms/${roomId}/state.yjs`, document: `rooms/${roomId}/document.toml` };
}

export interface ArchivedRoom {
	readonly commit: number;
	readonly bytes: number;
}

export async function archiveRoom(
	bucket: R2Bucket,
	roomId: string,
	state: RoomState,
): Promise<ArchivedRoom> {
	const document = readLogicDocument(state.doc);
	if (!document.ok) throw new Error('The room document cannot be archived: it is invalid');
	const update = Y.encodeStateAsUpdate(state.doc);
	const keys = archiveKeys(roomId);
	const customMetadata = {
		[COMMIT_METADATA]: String(state.commit),
		archivedAt: new Date().toISOString(),
	};
	await bucket.put(keys.state, update, { customMetadata });
	await bucket.put(keys.document, serializeSequitToml(document.value), {
		customMetadata,
		httpMetadata: { contentType: 'application/toml; charset=utf-8' },
	});
	return { commit: state.commit, bytes: update.byteLength };
}

function archivedCommit(object: R2Object): number {
	const commit = Number(object.customMetadata?.[COMMIT_METADATA]);
	if (!Number.isSafeInteger(commit) || commit < 1)
		throw new Error('Archived room metadata is invalid');
	return commit;
}

/**
 * Rehydrates the Durable Object storage from the archive when one exists. The archived update is
 * validated before anything is written so that a damaged archive never poisons the hot storage.
 */
export async function restoreArchivedRoom(
	bucket: R2Bucket,
	storage: DurableObjectStorage,
	roomId: string,
): Promise<ArchivedRoom | undefined> {
	const object = await bucket.get(archiveKeys(roomId).state);
	if (object === null) return undefined;
	const commit = archivedCommit(object);
	const fullUpdate = new Uint8Array(await object.arrayBuffer());
	const chunks = splitChunks(fullUpdate);
	const stored = new Map(chunkKeys(chunks.length).map((key, index) => [key, chunks[index]]));
	const meta = { commit, chunkCount: chunks.length, acceptedProposals: {} };
	decodeStoredRoomState(meta, stored, roomId).doc.destroy();
	const plan = planPersistence({
		fullUpdate,
		commit,
		currentChunkCount: 0,
		acceptedProposals: new Map(),
	});
	await persistRoomState(storage, plan);
	return { commit, bytes: fullUpdate.byteLength };
}

export function emptyRoomState(): RoomState {
	return { doc: new Y.Doc({ gc: false }), commit: 0, chunkCount: 0, acceptedProposals: new Map() };
}

export interface RoomHost {
	readonly ctx: DurableObjectState;
	readonly env: Env;
	readonly journal: RoomJournal;
}

/** Hot storage first; an empty room then looks for its archive before opening as new. */
export async function restoreRoom(host: RoomHost, current: RoomState): Promise<RoomState> {
	const roomId = host.ctx.id.name;
	const started = Date.now();
	let state = await restoreRoomState(host.ctx.storage, current, roomId);
	let source = 'storage';
	if (state.commit === 0) {
		source = 'empty';
		if (roomId !== undefined) {
			const archived = await restoreArchivedRoom(host.env.ROOM_ARCHIVE, host.ctx.storage, roomId);
			if (archived !== undefined) {
				state = await restoreRoomState(host.ctx.storage, state, roomId);
				source = 'archive';
			}
		}
	}
	host.journal.info('restored', { source, commit: state.commit, ms: Date.now() - started });
	return state;
}

export function scheduleIdleAlarm(ctx: DurableObjectState): Promise<void> {
	return ctx.storage.setAlarm(Date.now() + IDLE_BEFORE_ARCHIVE_MS);
}

/**
 * Archives an idle room to R2 and frees its storage. Returns the empty state to adopt, or
 * `undefined` when a participant is (still or again) connected and the room stays hot.
 */
export async function retireIdleRoom(
	host: RoomHost,
	state: RoomState,
): Promise<RoomState | undefined> {
	const roomId = host.ctx.id.name;
	if (state.commit > 0 && roomId !== undefined) {
		const archived = await archiveRoom(host.env.ROOM_ARCHIVE, roomId, state);
		host.journal.info('archived', { ...archived });
	}
	// A participant may have connected while the archive was uploading: keep the room hot.
	const sockets = host.ctx.getWebSockets().length;
	if (sockets > 0) {
		host.journal.info('idle-deferred', { sockets });
		await scheduleIdleAlarm(host.ctx);
		return undefined;
	}
	await host.ctx.storage.deleteAll();
	await host.ctx.storage.deleteAlarm();
	state.doc.destroy();
	host.journal.info('purged');
	return emptyRoomState();
}
