import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';

import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
} from '../../../src/lib/collaboration/protocol';
import {
	chunkKeys,
	concatChunks,
	type DocumentMeta,
	MAX_CHUNKS,
	META_KEY,
	type PersistencePlan,
} from '../../../src/lib/collaboration/room-persistence';

interface RoomState {
	readonly doc: Y.Doc;
	readonly commit: number;
	readonly chunkCount: number;
	readonly acceptedProposals: ReadonlyMap<string, number>;
}

function emptyRoomState(): RoomState {
	return {
		doc: new Y.Doc(),
		commit: 0,
		chunkCount: 0,
		acceptedProposals: new Map(),
	};
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	if (typeof value !== 'number') return false;
	return Number.isSafeInteger(value) && value >= 0;
}

function isAcceptedProposals(value: unknown): value is Readonly<Record<string, number>> {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	return Object.values(value).every(isNonNegativeSafeInteger);
}

function isDocumentMeta(value: unknown): value is DocumentMeta {
	if (typeof value !== 'object') return false;
	if (value === null || Array.isArray(value)) return false;
	if (!('commit' in value)) return false;
	if (!isNonNegativeSafeInteger(value.commit)) return false;
	if (!('chunkCount' in value)) return false;
	if (!isNonNegativeSafeInteger(value.chunkCount)) return false;
	if (value.chunkCount > MAX_CHUNKS) return false;
	if (!('acceptedProposals' in value)) return false;
	return isAcceptedProposals(value.acceptedProposals);
}

function isPingPayload(payload: unknown): boolean {
	if (typeof payload !== 'object') return false;
	if (payload === null) return false;
	return 'type' in payload && payload.type === 'ping';
}

function storedChunk(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value;
	return undefined;
}

/* istanbul ignore next -- exhaustive switch guards are unreachable after type checking */
function assertNever(value: never): never {
	throw new TypeError(`Unexpected client message: ${String(value)}`);
}

export async function persistRoomState(
	storage: DurableObjectStorage,
	plan: PersistencePlan,
): Promise<void> {
	const entries: Record<string, DocumentMeta | Uint8Array> = { [META_KEY]: plan.meta };
	const keys = chunkKeys(plan.chunks.length);
	for (const [index, chunk] of plan.chunks.entries()) {
		const key = keys[index];
		/* istanbul ignore else -- persistence plans always pair every chunk with a key */
		if (key !== undefined) entries[key] = chunk;
	}
	await storage.transaction(async (transaction) => {
		await transaction.put(entries);
		if (plan.staleChunkKeys.length > 0) {
			await transaction.delete([...plan.staleChunkKeys]);
		}
	});
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
		const storedMeta = await this.ctx.storage.get(META_KEY);
		if (storedMeta === undefined) return this.roomState;
		if (!isDocumentMeta(storedMeta)) throw new Error('Stored document metadata is invalid');

		const keys = [...chunkKeys(storedMeta.chunkCount)];
		const storedChunks = await this.ctx.storage.get(keys);
		const fullUpdate = concatChunks(keys.map((key) => storedChunk(storedChunks.get(key))));
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, fullUpdate);
		} catch (error) {
			doc.destroy();
			throw new Error('Stored document update is invalid', { cause: error });
		}
		return {
			doc,
			commit: storedMeta.commit,
			chunkCount: storedMeta.chunkCount,
			acceptedProposals: new Map(Object.entries(storedMeta.acceptedProposals)),
		};
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
				this.sendProtocolError(socket, 'proposals-not-supported');
				return Promise.resolve();
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

	private send(socket: WebSocket, message: CollabMessage): void {
		socket.send(encodeCollabMessage(message));
	}

	private sendProtocolError(socket: WebSocket, message: string): void {
		this.send(socket, { type: CollabMessageKind.ProtocolError, message });
	}

	override webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}
}
