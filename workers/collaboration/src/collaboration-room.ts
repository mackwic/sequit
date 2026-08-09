import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import {
	type AuthorizationResult,
	authorizeProposal,
} from '../../../src/lib/collaboration/authorize-proposal';
import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	type ProposalMessage,
	type ProtocolDiagnostic,
} from '../../../src/lib/collaboration/protocol';
import {
	GateDecisionKind,
	postAuthorizationGate,
	preAuthorizationGate,
	type RoomSnapshot,
} from '../../../src/lib/collaboration/room-decision';
import {
	type PersistencePlan,
	planPersistence,
} from '../../../src/lib/collaboration/room-persistence';
import { defaultUpdateGuards } from '../../../src/lib/collaboration/update-guards';
import { readStructuralLogicDocument } from '../../../src/lib/collaboration/yjs-document-reader';
import { YJS_LIVE_DOCUMENT_FORMAT } from '../../../src/lib/collaboration/yjs-document-schema';
import type { LogicDocument } from '../../../src/lib/document/logic-document';
import { persistRoomState, restoreRoomState, type RoomState } from './room-storage';

function emptyRoomState(): RoomState {
	return {
		doc: new Y.Doc(),
		commit: 0,
		chunkCount: 0,
		acceptedProposals: new Map(),
	};
}

function isPingPayload(payload: unknown): boolean {
	if (typeof payload !== 'object') return false;
	if (payload === null) return false;
	return 'type' in payload && payload.type === 'ping';
}

/* istanbul ignore next -- exhaustive switch guards are unreachable after type checking */
function assertNever(value: never): never {
	throw new TypeError(`Unexpected client message: ${String(value)}`);
}

export class CollaborationRoom extends DurableObject<Env> {
	private roomState = emptyRoomState();
	private processing: Promise<void> = Promise.resolve();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		void ctx.blockConcurrencyWhile(async () => {
			this.roomState = await this.restore();
		});
	}

	private async restore(): Promise<RoomState> {
		return restoreRoomState(this.ctx.storage, this.roomState);
	}

	override fetch(request: Request): Response {
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			return Response.json(
				{ error: 'WebSocket upgrade required' },
				{ status: 426, headers: { 'cache-control': 'no-store' } },
			);
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server);
		server.send(JSON.stringify({ type: 'ready' }));
		return new Response(null, { status: 101, webSocket: client });
	}

	override webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): void {
		if (typeof message === 'string') {
			this.handleControlMessage(socket, message);
			return;
		}
		const decoded = decodeCollabMessage(new Uint8Array(message));
		if (!decoded.ok) {
			const diagnosticMessage = decoded.diagnostics.map(({ message }) => message).join('; ');
			this.sendProtocolError(socket, diagnosticMessage);
			return;
		}
		this.enqueue(socket, () => this.handleProtocolMessage(socket, decoded.value));
	}

	private handleControlMessage(socket: WebSocket, message: string): void {
		try {
			const payload: unknown = JSON.parse(message);
			if (isPingPayload(payload)) {
				socket.send(JSON.stringify({ type: 'pong' }));
				return;
			}
		} catch {
			// Invalid JSON is answered on the text control channel like every non-ping message.
		}
		socket.send(JSON.stringify({ type: CollabMessageKind.ProtocolError }));
	}

	private enqueue(socket: WebSocket, task: () => Promise<void>): void {
		this.processing = this.processing.then(async () => {
			try {
				await task();
			} catch {
				this.sendProtocolError(socket, 'Protocol message could not be processed');
			}
		});
	}

	private handleProtocolMessage(socket: WebSocket, message: CollabMessage): Promise<void> {
		switch (message.type) {
			case CollabMessageKind.SyncRequest:
				this.send(socket, {
					type: CollabMessageKind.SyncResponse,
					commit: this.roomState.commit,
					update: Y.encodeStateAsUpdate(this.roomState.doc, message.stateVector),
					stateVector: Y.encodeStateVector(this.roomState.doc),
				});
				return Promise.resolve();
			case CollabMessageKind.Proposal:
				return this.handleProposal(socket, message);
			case CollabMessageKind.SyncResponse:
			case CollabMessageKind.Accepted:
			case CollabMessageKind.Rejected:
			case CollabMessageKind.ProtocolError:
				this.sendProtocolError(socket, `Unexpected client message: ${message.type}`);
				return Promise.resolve();
			/* istanbul ignore next -- exhaustive switch guard */
			default:
				return assertNever(message);
		}
	}

	private roomSnapshot(): RoomSnapshot {
		return {
			roomId: this.ctx.id.name,
			commit: this.roomState.commit,
			acceptedProposals: this.roomState.acceptedProposals,
		};
	}

	private acceptedDocument(): LogicDocument | undefined {
		if (this.roomState.commit === 0) return undefined;
		const result = readStructuralLogicDocument(this.roomState.doc, YJS_LIVE_DOCUMENT_FORMAT);
		if (!result.ok) throw new Error('Authoritative document is invalid');
		return result.value;
	}

	private handlePreAuthorizationDecision(socket: WebSocket, message: ProposalMessage): boolean {
		const decision = preAuthorizationGate(this.roomSnapshot(), message);
		switch (decision.kind) {
			case GateDecisionKind.Proceed:
				return false;
			case GateDecisionKind.ReAcknowledge:
				this.send(socket, {
					type: CollabMessageKind.Accepted,
					proposalId: message.proposalId,
					commit: decision.commit,
					update: new Uint8Array(),
					stateVector: Y.encodeStateVector(this.roomState.doc),
				});
				return true;
			case GateDecisionKind.Reject:
				this.reject(socket, message.proposalId, decision.diagnostics);
				return true;
			/* istanbul ignore next -- exhaustive switch guard */
			default:
				return assertNever(decision);
		}
	}

	private async authorize(message: ProposalMessage): Promise<AuthorizationResult | undefined> {
		try {
			return await authorizeProposal({
				proposalId: message.proposalId,
				authoritative: this.roomState.doc,
				acceptedDocument: this.acceptedDocument(),
				proposedUpdate: message.update,
				guards: defaultUpdateGuards,
			});
		} catch {
			return undefined;
		}
	}

	private handlePostAuthorizationDecision(
		socket: WebSocket,
		message: ProposalMessage,
		candidateDocument: LogicDocument,
		fullUpdateByteLength: number,
	): boolean {
		const decision = postAuthorizationGate(
			this.roomSnapshot(),
			message,
			candidateDocument,
			fullUpdateByteLength,
		);
		switch (decision.kind) {
			case GateDecisionKind.Proceed:
				return false;
			case GateDecisionKind.Reject:
				this.reject(socket, message.proposalId, decision.diagnostics);
				return true;
			/* istanbul ignore next -- post-authorization gates never produce this decision */
			case GateDecisionKind.ReAcknowledge:
				throw new Error('Post-authorization gate cannot re-acknowledge a proposal');
			/* istanbul ignore next -- exhaustive switch guard */
			default:
				return assertNever(decision);
		}
	}

	private async handleProposal(socket: WebSocket, message: ProposalMessage): Promise<void> {
		if (this.handlePreAuthorizationDecision(socket, message)) return;

		const result = await this.authorize(message);
		if (result === undefined) {
			this.sendProtocolError(socket, 'Internal authorization failure');
			return;
		}
		if (!result.ok) {
			this.reject(socket, message.proposalId, result.diagnostics);
			return;
		}

		const fullUpdate = Y.encodeStateAsUpdate(result.value.candidate);
		const rejected = this.handlePostAuthorizationDecision(
			socket,
			message,
			result.value.candidateDocument,
			fullUpdate.byteLength,
		);
		if (rejected) {
			result.value.candidate.destroy();
			return;
		}

		await this.commitProposal(socket, message, result, fullUpdate);
	}

	private async commitProposal(
		socket: WebSocket,
		message: ProposalMessage,
		result: Extract<AuthorizationResult, { readonly ok: true }>,
		fullUpdate: Uint8Array,
	): Promise<void> {
		const commit = this.roomState.commit + 1;
		const acceptedProposals = new Map(this.roomState.acceptedProposals);
		acceptedProposals.set(message.proposalId, commit);
		const plan = planPersistence({
			fullUpdate,
			commit,
			currentChunkCount: this.roomState.chunkCount,
			acceptedProposals,
		});
		try {
			await this.persist(plan);
		} catch {
			result.value.candidate.destroy();
			this.sendProtocolError(socket, 'Internal persistence failure');
			return;
		}

		const previous = this.roomState;
		const delta = Y.encodeStateAsUpdate(result.value.candidate, Y.encodeStateVector(previous.doc));
		this.roomState = {
			doc: result.value.candidate,
			commit,
			chunkCount: plan.chunks.length,
			acceptedProposals: plan.acceptedProposals,
		};
		previous.doc.destroy();
		const frame = encodeCollabMessage({
			type: CollabMessageKind.Accepted,
			proposalId: message.proposalId,
			commit,
			update: delta,
			stateVector: Y.encodeStateVector(this.roomState.doc),
		});
		for (const peer of this.ctx.getWebSockets()) peer.send(frame);
	}

	private persist(plan: PersistencePlan): Promise<void> {
		return persistRoomState(this.ctx.storage, plan);
	}

	private send(socket: WebSocket, message: CollabMessage): void {
		socket.send(encodeCollabMessage(message));
	}

	private sendProtocolError(socket: WebSocket, message: string): void {
		this.send(socket, { type: CollabMessageKind.ProtocolError, message });
	}

	private reject(
		socket: WebSocket,
		proposalId: string,
		diagnostics: readonly ProtocolDiagnostic[],
	): void {
		this.send(socket, { type: CollabMessageKind.Rejected, proposalId, diagnostics });
	}

	override webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}
}
