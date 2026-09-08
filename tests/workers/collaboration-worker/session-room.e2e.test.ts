import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
	type ProposalDecision,
	ProposalDecisionKind,
} from '../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	ProposalIntent,
} from '../../../src/lib/infrastructure/collaboration/protocol';
import type {
	CollaborationWebSocket,
	CollaborationWebSocketFactory,
} from '../../../src/lib/infrastructure/collaboration/websocket-collaboration-transport';
import { createWebSocketCollaborationTransport } from '../../../src/lib/infrastructure/collaboration/websocket-collaboration-transport';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import worker from '../../../src/workers/collaboration-worker/index';
import { collaborativeDocument, proposeChange } from '../../support/builders/collaboration';

type SocketListener = Parameters<CollaborationWebSocket['addEventListener']>[1];

class WorkerdWebSocket implements CollaborationWebSocket {
	binaryType = 'arraybuffer';
	readonly #listeners = new Map<string, Set<SocketListener>>();
	#socket: WebSocket | undefined;
	#closed = false;

	constructor(url: string) {
		void this.connect(url);
	}

	get readyState(): number {
		return this.#socket?.readyState ?? 0;
	}

	send(data: Uint8Array): void {
		this.#socket?.send(data);
	}

	close(code = 1000): void {
		this.#closed = true;
		this.#socket?.close(code, 'Transport closed');
	}

	addEventListener(type: string, listener: SocketListener): void {
		const listeners = this.#listeners.get(type) ?? new Set<SocketListener>();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: SocketListener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	async connect(url: string): Promise<void> {
		const requestUrl = new URL(url);
		if (requestUrl.protocol === 'wss:') requestUrl.protocol = 'https:';
		else requestUrl.protocol = 'http:';
		const response = await worker.fetch(
			new Request(requestUrl, { headers: { upgrade: 'websocket' } }),
			env,
		);
		const socket = response.webSocket;
		if (socket === null) throw new Error('Expected upgraded socket');
		if (this.#closed) {
			socket.accept();
			socket.close(1000, 'Transport closed before connection');
			return;
		}
		this.#socket = socket;
		socket.binaryType = 'arraybuffer';
		socket.addEventListener('message', (event) => {
			this.dispatch('message', event);
		});
		socket.addEventListener('close', (event) => {
			this.dispatch('close', event);
		});
		socket.accept();
	}

	private dispatch(type: string, event: Event): void {
		for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
	}
}

const workerdWebSocketFactory: CollaborationWebSocketFactory = (url) => new WorkerdWebSocket(url);

function nextMessage(socket: WebSocket): Promise<MessageEvent> {
	const { promise, resolve } = Promise.withResolvers<MessageEvent>();
	socket.addEventListener('message', resolve, { once: true });
	return promise;
}

async function nextFrame(socket: WebSocket): Promise<CollabMessage> {
	const event = await nextMessage(socket);
	if (!(event.data instanceof ArrayBuffer)) throw new TypeError('Expected binary frame');
	const decoded = decodeCollabMessage(new Uint8Array(event.data));
	if (!decoded.ok) throw new TypeError('Expected decodable frame');
	return decoded.value;
}

async function openSocket(roomId: string): Promise<WebSocket> {
	const response = await env.COLLABORATION_ROOMS.getByName(roomId).fetch(
		`https://sequit.local/collab/${roomId}`,
		{ headers: { upgrade: 'websocket' } },
	);
	const socket = response.webSocket;
	if (socket === null) throw new Error('Expected upgraded socket');
	socket.binaryType = 'arraybuffer';
	socket.accept();
	await nextMessage(socket);
	return socket;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('Collaboration session did not settle');
}

async function createSession(roomId: string): Promise<{
	readonly decisions: ProposalDecision[];
	readonly session: ReturnType<typeof createCollaborativeDocumentSession>;
}> {
	const transport = createWebSocketCollaborationTransport(
		roomId,
		'https://sequit.local/',
		workerdWebSocketFactory,
	);
	const session = createCollaborativeDocumentSession(collaborativeDocument(roomId), transport);
	const decisions: ProposalDecision[] = [];
	session.subscribeToDecisions((decision) => {
		decisions.push(decision);
	});
	await waitUntil(() => session.connectionStatus() === CollaborationStatus.Ready);
	return { decisions, session };
}

function acceptedChange(
	decisions: readonly ProposalDecision[],
	commit: number,
): ProposalDecision | undefined {
	return decisions.find(
		(decision) =>
			decision.type === ProposalDecisionKind.Accepted &&
			decision.proposalId !== undefined &&
			decision.commit === commit,
	);
}

describe('real session and collaboration room', () => {
	it('authorizes two real sessions and rejects a cycle only to its proposer', async () => {
		const roomId = 'system-authorized-collaboration';
		const first = await createSession(roomId);
		const second = await createSession(roomId);

		expect(second.session.read()).toEqual(first.session.read());
		expect(first.decisions).toContainEqual(
			expect.objectContaining({ type: ProposalDecisionKind.Accepted, commit: 1 }),
		);

		expect(first.session.replaceNodeMarkdown('source-a', 'First session edit')).toBe(true);
		await waitUntil(() => acceptedChange(first.decisions, 2) !== undefined);
		await waitUntil(() =>
			second.session.read().nodes.some(({ markdown }) => markdown === 'First session edit'),
		);
		const firstAcceptance = acceptedChange(first.decisions, 2);
		expect(firstAcceptance).toMatchObject({
			type: ProposalDecisionKind.Accepted,
			commit: 2,
		});
		if (firstAcceptance?.type !== ProposalDecisionKind.Accepted)
			throw new TypeError('Expected first acceptance');
		expect(typeof firstAcceptance.proposalId).toBe('string');

		expect(second.session.replaceNodeMarkdown('source-b', 'Second session edit')).toBe(true);
		await waitUntil(() => acceptedChange(second.decisions, 3) !== undefined);
		await waitUntil(() =>
			first.session.read().nodes.some(({ markdown }) => markdown === 'Second session edit'),
		);
		const secondAcceptance = acceptedChange(second.decisions, 3);
		expect(secondAcceptance).toMatchObject({
			type: ProposalDecisionKind.Accepted,
			commit: 3,
		});
		if (secondAcceptance?.type !== ProposalDecisionKind.Accepted)
			throw new TypeError('Expected second acceptance');
		expect(typeof secondAcceptance.proposalId).toBe('string');
		expect(second.session.read()).toEqual(first.session.read());

		const proposer = await openSocket(roomId);
		const observer = await openSocket(roomId);
		const authoritative = new Y.Doc();
		const empty = new Y.Doc();
		proposer.send(
			encodeCollabMessage({
				type: CollabMessageKind.SyncRequest,
				lastCommit: 0,
				stateVector: Y.encodeStateVector(empty),
			}),
		);
		const sync = await nextFrame(proposer);
		if (sync.type !== CollabMessageKind.SyncResponse)
			throw new TypeError('Expected authoritative sync response');
		Y.applyUpdate(authoritative, sync.update);
		const cyclicUpdate = proposeChange(authoritative, (candidate) => {
			candidate
				.getMap<Y.Map<unknown>>(YjsCollection.Relations)
				.set('cycle', createYjsEntityMap({ from: 'target', to: 'source-a' }));
		});
		proposer.send(
			encodeCollabMessage({
				type: CollabMessageKind.Proposal,
				proposalId: 'system-cycle-proposal',
				intent: ProposalIntent.Change,
				update: cyclicUpdate,
			}),
		);
		expect(await nextFrame(proposer)).toMatchObject({
			type: CollabMessageKind.Rejected,
			proposalId: 'system-cycle-proposal',
			diagnostics: [{ code: 'cycle', path: ['relations'] }],
		});

		const observerSentinel = nextMessage(observer);
		observer.send(JSON.stringify({ type: 'ping' }));
		const observerResponse = await observerSentinel;
		expect(observerResponse.data).toBe(JSON.stringify({ type: 'pong' }));
		expect(first.decisions).toHaveLength(2);
		expect(second.decisions).toHaveLength(1);
		expect(second.session.read()).toEqual(first.session.read());

		empty.destroy();
		authoritative.destroy();
		proposer.close(1000, 'Complete');
		observer.close(1000, 'Complete');
		first.session.destroy();
		second.session.destroy();
	});
});
