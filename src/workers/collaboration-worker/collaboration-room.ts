import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import type { CommandSequence } from '../../lib/infrastructure/collaboration/command-sequence';
import { compactRoomDocument } from '../../lib/infrastructure/collaboration/compact-room-document';
import { planPersistence } from '../../lib/infrastructure/collaboration/room-persistence';
import {
	RetryableSessionFailure,
	SessionFailureCode,
} from '../../lib/infrastructure/collaboration/session-failure';
import {
	decodeSessionEnvelope,
	type SessionMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../lib/infrastructure/collaboration/sync-steps';
import { readCommandReceipt } from './command-receipts';
import {
	emptyRoomState,
	restoreRoom,
	retireIdleRoom,
	type RoomHost,
	scheduleIdleAlarm,
} from './room-archive';
import { handleRoomFailure } from './room-failures';
import { type RoomJournal, roomJournal, roomLabel } from './room-log';
import {
	authorizeCommands,
	authorizeInitialization,
	authorizeTextUpdate,
	type CommandsMessage,
	type InitializeMessage,
	type ProposalContext,
	type TextChangeMessage,
} from './room-proposals';
import { RoomRefusalBudget } from './room-refusal-budget';
import {
	broadcastRoomPresence,
	rememberSocketVersion,
	roomPresence,
	sendRoomMessage,
	storeSocketPresence,
} from './room-sockets';
import { persistRoomState } from './room-storage';

/** One Durable Object serves a room on a single thread; beyond this the room is full. */
export const MAX_ROOM_SOCKETS = 50;

export class CollaborationRoom extends DurableObject<Env> {
	private roomState = emptyRoomState();
	private processing: Promise<void> = Promise.resolve();
	private readonly refusalBudget = new RoomRefusalBudget();
	private journal: RoomJournal = roomJournal('starting');
	/** Set by the alarm once the storage is gone while this instance is still in memory. */
	private purged = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			this.journal = roomJournal(await roomLabel(ctx.id.name));
			this.roomState = await restoreRoom(this.host(), this.roomState);
		});
	}

	private host(): RoomHost {
		return { ctx: this.ctx, env: this.env, journal: this.journal };
	}

	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
			return Response.json({ error: 'WebSocket upgrade required' }, { status: 426 });
		const sockets = this.ctx.getWebSockets().length;
		if (sockets >= MAX_ROOM_SOCKETS) {
			this.journal.warn('full', { sockets });
			return Response.json({ error: 'Room full' }, { status: 429 });
		}
		if (this.purged) {
			await this.ctx.blockConcurrencyWhile(async () => {
				this.roomState = await restoreRoom(this.host(), this.roomState);
			});
			this.purged = false;
		}
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		await scheduleIdleAlarm(this.ctx);
		pair[1].send(JSON.stringify({ type: 'ready' }));
		sendRoomMessage(pair[1], roomPresence(this.ctx.getWebSockets()));
		this.journal.info('connected', { sockets: sockets + 1, commit: this.roomState.commit });
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	override webSocketMessage(socket: WebSocket, frame: ArrayBuffer | string): Promise<void> {
		const run = async (): Promise<void> => {
			if (socket.readyState !== WebSocket.OPEN) return;
			let code = SessionFailureCode.InvalidMessage;
			try {
				if (typeof frame === 'string') {
					this.control(socket, frame);
					return;
				}
				const message = decodeSessionEnvelope(new Uint8Array(frame));
				rememberSocketVersion(socket, message.version);
				code = SessionFailureCode.InvalidDocument;
				await this.handle(socket, message.message);
			} catch (error) {
				const outcome = handleRoomFailure(socket, error, code);
				if (outcome !== undefined) this.journal.warn(outcome.kind, { ...outcome });
			}
		};
		this.processing = this.processing.then(run, run);
		return this.processing;
	}

	private control(socket: WebSocket, frame: string): void {
		if (frame.length > 1_024) throw new Error('Message de contrôle trop volumineux.');
		const value: unknown = JSON.parse(frame);
		const objectValue = typeof value === 'object';
		if (!objectValue || value === null) throw new Error('Message invalide.');
		if ('type' in value && value.type === 'ping') {
			socket.send(JSON.stringify({ type: 'pong' }));
			return;
		}
		throw new Error('Message invalide.');
	}

	private async handle(socket: WebSocket, message: SessionMessage): Promise<void> {
		switch (message.type) {
			case SessionMessageKind.Sync: {
				const step = readSyncStep(message.payload);
				if (step.kind === SyncStepKind.Request) {
					sendRoomMessage(socket, {
						type: SessionMessageKind.Sync,
						payload: writeSyncResponse(this.roomState.doc, step.stateVector),
					});
					sendRoomMessage(socket, {
						type: SessionMessageKind.Sync,
						payload: writeSyncRequest(this.roomState.doc),
					});
				} else {
					await this.acceptUpdate(socket, step.update);
				}
				return;
			}
			case SessionMessageKind.Initialize:
				await this.initialize(socket, message);
				return;
			case SessionMessageKind.Change:
				if ('update' in message) await this.acceptUpdate(socket, message.update, message);
				else await this.acceptCommands(socket, message);
				return;
			case SessionMessageKind.Presence:
				if (message.participants.length !== 1) return;
				try {
					storeSocketPresence(socket, message);
				} catch {
					return;
				}
				broadcastRoomPresence(this.ctx.getWebSockets());
				return;
			case SessionMessageKind.Commit:
			case SessionMessageKind.Reject:
			case SessionMessageKind.Retry:
			case SessionMessageKind.Conflict:
			default:
				throw new Error('Message client invalide.');
		}
	}

	private proposal(socket: WebSocket): ProposalContext {
		return { state: this.roomState, socket, budget: this.refusalBudget };
	}

	/** Answers a replayed proposal with the current state so the client catches up. */
	private replayCurrent(socket: WebSocket, id: string): void {
		sendRoomMessage(socket, {
			type: SessionMessageKind.Commit,
			id,
			commit: this.roomState.commit,
			update: Y.encodeStateAsUpdate(this.roomState.doc),
		});
	}

	private async initialize(socket: WebSocket, message: InitializeMessage): Promise<void> {
		// The room may have been initialized by another participant during the handshake.
		if (this.roomState.commit > 0) {
			this.replayCurrent(socket, message.id);
			return;
		}
		const candidate = await authorizeInitialization(this.roomState, this.ctx.id.name, message);
		try {
			await this.commit(candidate, message.id, undefined, socket);
		} finally {
			candidate.destroy();
		}
	}

	private async acceptCommands(socket: WebSocket, message: CommandsMessage): Promise<void> {
		const acceptedSequence = await readCommandReceipt(this.ctx.storage, message);
		if (message.sequence <= acceptedSequence) {
			this.replayCurrent(socket, message.id);
			return;
		}
		if (message.sequence !== acceptedSequence + 1)
			throw new RetryableSessionFailure(
				SessionFailureCode.CommandGap,
				'Une commande précédente manque. Synchronisation en cours.',
			);
		const candidate = authorizeCommands(this.proposal(socket), message, acceptedSequence);
		if (candidate === undefined) return;
		try {
			await this.commit(candidate, message.id, message, socket);
		} finally {
			candidate.destroy();
		}
	}

	private async acceptUpdate(
		socket: WebSocket,
		update: Uint8Array,
		message?: TextChangeMessage,
	): Promise<void> {
		const candidate = await authorizeTextUpdate(this.proposal(socket), update, message);
		if (candidate === undefined) return;
		try {
			await this.commit(candidate);
			if (message?.id !== undefined)
				sendRoomMessage(socket, {
					type: SessionMessageKind.Commit,
					id: message.id,
					commit: this.roomState.commit,
					update: Y.encodeStateAsUpdate(
						this.roomState.doc,
						Y.encodeStateVector(this.roomState.doc),
					),
				});
		} finally {
			candidate.destroy();
		}
	}

	private async commit(
		candidate: Y.Doc,
		id?: string,
		command?: CommandSequence,
		origin?: WebSocket,
	): Promise<void> {
		// Yjs recognizes replays; unchanged text syncs do not need another persisted commit.
		if (id === undefined && Y.equalSnapshots(Y.snapshot(candidate), Y.snapshot(this.roomState.doc)))
			return;
		compactRoomDocument(candidate);
		const update = Y.encodeStateAsUpdate(candidate, Y.encodeStateVector(this.roomState.doc));
		const commit = this.roomState.commit + 1;
		const acceptedProposals = new Map(this.roomState.acceptedProposals);
		// Legacy UUID receipts remain readable; protocol v4 stores durable session progress separately.
		if (id !== undefined && command === undefined) acceptedProposals.set(id, commit);
		const plan = planPersistence({
			fullUpdate: Y.encodeStateAsUpdate(candidate),
			commit,
			currentChunkCount: this.roomState.chunkCount,
			acceptedProposals,
		});
		await persistRoomState(this.ctx.storage, plan, command);
		Y.applyUpdate(this.roomState.doc, update);
		compactRoomDocument(this.roomState.doc);
		this.roomState = {
			doc: this.roomState.doc,
			commit,
			chunkCount: plan.chunks.length,
			acceptedProposals: plan.acceptedProposals,
		};
		const message: SessionMessage = { type: SessionMessageKind.Commit, update, commit };
		for (const peer of this.ctx.getWebSockets()) {
			if (peer === origin && id !== undefined) sendRoomMessage(peer, { ...message, id });
			else sendRoomMessage(peer, message);
		}
		// Text syncs arrive with every keystroke batch; only structural commits are journaled.
		if (command !== undefined)
			this.journal.info('commands', {
				commit,
				session: command.sessionId,
				sequence: command.sequence,
			});
		else if (id !== undefined)
			this.journal.info('initialized', { commit, bytes: update.byteLength });
	}

	override async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
		let outgoingCode = code;
		if ([1005, 1006, 1015].includes(code)) outgoingCode = 1000;
		socket.close(outgoingCode, reason);
		const remaining = this.ctx.getWebSockets().filter((peer) => peer !== socket);
		broadcastRoomPresence(remaining, socket);
		this.journal.info('disconnected', { code, sockets: remaining.length });
		await scheduleIdleAlarm(this.ctx);
	}

	/** Fires once no participant has connected for a day: archive to R2, then free the object. */
	override async alarm(): Promise<void> {
		const sockets = this.ctx.getWebSockets().length;
		if (sockets > 0) {
			this.journal.info('idle-deferred', { sockets });
			await scheduleIdleAlarm(this.ctx);
			return;
		}
		const run = async (): Promise<void> => {
			const retired = await retireIdleRoom(this.host(), this.roomState);
			if (retired === undefined) return;
			this.roomState = retired;
			this.purged = true;
		};
		this.processing = this.processing.then(run, run);
		try {
			await this.processing;
		} catch (error) {
			this.journal.error('archive-failed', error);
			throw error;
		}
	}
}
