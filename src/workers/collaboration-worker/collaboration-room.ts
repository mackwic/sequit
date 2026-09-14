import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import { authorizeProposal } from '../../lib/infrastructure/collaboration/authorize-proposal';
import type { CommandSequence } from '../../lib/infrastructure/collaboration/command-sequence';
import { compactRoomDocument } from '../../lib/infrastructure/collaboration/compact-room-document';
import { InvalidPresenceError } from '../../lib/infrastructure/collaboration/participant-presence';
import { planPersistence } from '../../lib/infrastructure/collaboration/room-persistence';
import {
	RetryableSessionFailure,
	SessionFailureCode,
} from '../../lib/infrastructure/collaboration/session-failure';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	type ParticipantPresence,
	type SessionMessage,
	SessionMessageKind,
} from '../../lib/infrastructure/collaboration/session-wire';
import { executeSharedCommands } from '../../lib/infrastructure/collaboration/shared-command-executor';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../lib/infrastructure/collaboration/sync-steps';
import { defaultUpdateGuards } from '../../lib/infrastructure/collaboration/update-guards';
import { upgradeSharedTexts } from '../../lib/infrastructure/collaboration/upgrade-shared-texts';
import { readLogicDocument } from '../../lib/infrastructure/collaboration/yjs-document-codec';
import { readCommandReceipt } from './command-receipts';
import { persistRoomState, restoreRoomState, type RoomState } from './room-storage';

function emptyRoomState(): RoomState {
	return { doc: new Y.Doc({ gc: false }), commit: 0, chunkCount: 0, acceptedProposals: new Map() };
}

export class CollaborationRoom extends DurableObject<Env> {
	private roomState = emptyRoomState();
	private processing: Promise<void> = Promise.resolve();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			this.roomState = await restoreRoomState(this.ctx.storage, this.roomState, this.ctx.id.name);
		});
	}

	override fetch(request: Request): Response {
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
			return Response.json({ error: 'WebSocket upgrade required' }, { status: 426 });
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].send(JSON.stringify({ type: 'ready' }));
		this.sendPresence(pair[1]);
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
				const message = decodeSessionMessage(new Uint8Array(frame));
				code = SessionFailureCode.InvalidDocument;
				await this.handle(socket, message);
			} catch (error) {
				if (error instanceof InvalidPresenceError) return;
				if (error instanceof RetryableSessionFailure) {
					this.send(socket, {
						type: SessionMessageKind.Retry,
						code: error.code,
						message: error.message,
					});
					return;
				}
				let message = 'La modification a été refusée.';
				if (error instanceof Error) message = error.message;
				this.reject(socket, message, code);
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
					this.send(socket, {
						type: SessionMessageKind.Sync,
						payload: writeSyncResponse(this.roomState.doc, step.stateVector),
					});
					this.send(socket, {
						type: SessionMessageKind.Sync,
						payload: writeSyncRequest(this.roomState.doc),
					});
				} else {
					await this.acceptUpdate(step.update);
				}
				return;
			}
			case SessionMessageKind.Initialize:
				await this.initialize(socket, message);
				return;
			case SessionMessageKind.Change:
				if ('update' in message) await this.acceptUpdate(message.update);
				else await this.acceptCommands(socket, message);
				return;
			case SessionMessageKind.Presence:
				if (message.participants.length !== 1) return;
				try {
					socket.serializeAttachment(encodeSessionMessage(message));
				} catch {
					return;
				}
				this.broadcastPresence();
				return;
			case SessionMessageKind.Commit:
			case SessionMessageKind.Reject:
			case SessionMessageKind.Retry:
			default:
				throw new Error('Message client invalide.');
		}
	}

	private async initialize(
		socket: WebSocket,
		message: Extract<SessionMessage, { type: SessionMessageKind.Initialize }>,
	): Promise<void> {
		if (this.roomState.commit > 0) {
			// The room may have been initialized by another participant during the handshake.
			this.send(socket, {
				type: SessionMessageKind.Commit,
				id: message.id,
				commit: this.roomState.commit,
				update: Y.encodeStateAsUpdate(this.roomState.doc),
			});
			return;
		}
		const result = await authorizeProposal({
			proposalId: message.id,
			authoritative: this.roomState.doc,
			acceptedDocument: undefined,
			proposedUpdate: message.update,
			guards: defaultUpdateGuards,
		});
		if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
		try {
			if (result.value.candidateDocument.id !== this.ctx.id.name)
				throw new Error('Le document ne correspond pas à la room.');
			upgradeSharedTexts(result.value.candidate);
			await this.commit(result.value.candidate, message.id);
		} finally {
			result.value.candidate.destroy();
		}
	}

	private async acceptCommands(
		socket: WebSocket,
		message: Extract<SessionMessage, { readonly commands: unknown }>,
	): Promise<void> {
		const acceptedSequence = await readCommandReceipt(this.ctx.storage, message);
		if (message.sequence <= acceptedSequence) {
			this.send(socket, {
				type: SessionMessageKind.Commit,
				id: message.id,
				commit: this.roomState.commit,
				update: Y.encodeStateAsUpdate(this.roomState.doc),
			});
			return;
		}
		if (message.sequence !== acceptedSequence + 1)
			throw new RetryableSessionFailure(
				SessionFailureCode.CommandGap,
				'Une commande précédente manque. Synchronisation en cours.',
			);
		if (this.roomState.commit === 0)
			throw new Error('Initialisez le document avant les commandes.');
		const candidate = new Y.Doc({ gc: false });
		try {
			Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.roomState.doc));
			executeSharedCommands(candidate, message.commands);
			await this.commit(candidate, message.id, message);
		} finally {
			candidate.destroy();
		}
	}

	private async acceptUpdate(update: Uint8Array): Promise<void> {
		const decoded = Y.decodeUpdate(update);
		if (decoded.structs.length === 0 && decoded.ds.clients.size === 0) return;
		const accepted = readLogicDocument(this.roomState.doc);
		if (!accepted.ok) throw new Error('Initialisez le document avec des commandes.');
		const result = await authorizeProposal({
			authoritative: this.roomState.doc,
			acceptedDocument: accepted.value,
			proposedUpdate: update,
			guards: defaultUpdateGuards,
			textOnly: true,
		});
		if (!result.ok) throw new Error(result.diagnostics.map(({ message }) => message).join('; '));
		try {
			await this.commit(result.value.candidate);
		} finally {
			result.value.candidate.destroy();
		}
	}

	private async commit(candidate: Y.Doc, id?: string, command?: CommandSequence): Promise<void> {
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
		let message: SessionMessage = { type: SessionMessageKind.Commit, update, commit };
		if (id !== undefined) message = { ...message, id };
		for (const peer of this.ctx.getWebSockets()) this.send(peer, message);
	}

	private presenceMessage(excluded?: WebSocket): SessionMessage {
		const participants: ParticipantPresence[] = [];
		for (const peer of this.ctx.getWebSockets()) {
			if (peer === excluded) continue;
			try {
				const attachment: unknown = peer.deserializeAttachment();
				if (!(attachment instanceof Uint8Array)) continue;
				const message = decodeSessionMessage(attachment);
				if (message.type === SessionMessageKind.Presence)
					participants.push(...message.participants);
			} catch {
				// Presence is ephemeral; discard attachments left by an older protocol version.
			}
		}
		return { type: SessionMessageKind.Presence, participants };
	}

	private sendPresence(socket: WebSocket): void {
		this.send(socket, this.presenceMessage());
	}

	private broadcastPresence(excluded?: WebSocket): void {
		const message = this.presenceMessage(excluded);
		const frame = encodeSessionMessage(message);
		for (const peer of this.ctx.getWebSockets()) {
			if (peer === excluded) continue;
			try {
				peer.send(frame);
			} catch {
				/* A departed participant cannot interrupt the room. */
			}
		}
	}

	private send(socket: WebSocket, message: SessionMessage): void {
		try {
			socket.send(encodeSessionMessage(message));
		} catch {
			/* A closed peer must not prevent delivery to the room. */
		}
	}

	private reject(socket: WebSocket, message: string, code: SessionFailureCode): void {
		this.send(socket, { type: SessionMessageKind.Reject, code, message });
		socket.close(1008, 'Change rejected');
	}

	override webSocketClose(socket: WebSocket, code: number, reason: string): void {
		let outgoingCode = code;
		if ([1005, 1006, 1015].includes(code)) outgoingCode = 1000;
		socket.close(outgoingCode, reason);
		this.broadcastPresence(socket);
	}
}
