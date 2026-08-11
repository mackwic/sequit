import * as Y from 'yjs';

import { authorizeProposal } from '../../src/lib/collaboration/authorize-proposal';
import {
	type CollabMessage,
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	type ProposalMessage,
} from '../../src/lib/collaboration/protocol';
import {
	GateDecisionKind,
	postAuthorizationGate,
	preAuthorizationGate,
} from '../../src/lib/collaboration/room-decision';
import { defaultUpdateGuards } from '../../src/lib/collaboration/update-guards';
import { readLogicDocument } from '../../src/lib/collaboration/yjs-document-codec';
import type { CollaborationScenarioClient } from '../scenarios/collaboration';
import { createMemoryTransportPair, type MemoryTransport } from './memory-transport';

interface AuthorityPeer {
	readonly client: MemoryTransport;
	readonly server: MemoryTransport;
}

export class CollaborationAuthority {
	readonly #peers = new Set<AuthorityPeer>();
	readonly #acceptedProposals = new Map<string, number>();
	#doc = new Y.Doc();
	#commit = 0;
	#processing = Promise.resolve();

	constructor(readonly roomId: string) {}

	connect(): MemoryTransport {
		const pair = createMemoryTransportPair();
		const peer = { client: pair.client, server: pair.server };
		this.#peers.add(peer);
		pair.server.subscribeToFrames((frame) => {
			this.#processing = this.#processing.then(() => this.#handleFrame(peer, frame));
		});
		return pair.client;
	}

	async settle(): Promise<void> {
		for (;;) {
			const processing = this.#processing;
			await processing;
			if (processing === this.#processing) return;
		}
	}

	readAuthoritative(): ReturnType<typeof readLogicDocument> {
		return readLogicDocument(this.#doc);
	}

	stateVector(): Uint8Array {
		return Y.encodeStateVector(this.#doc);
	}

	commit(): number {
		return this.#commit;
	}

	scenarioClient(): CollaborationScenarioClient {
		const transport = this.connect();
		const frames: CollabMessage[] = [];
		const waiters: ((message: CollabMessage) => void)[] = [];
		transport.subscribeToFrames((frame) => {
			const decoded = decodeCollabMessage(frame);
			if (!decoded.ok) throw new TypeError('Expected a decodable frame');
			const waiter = waiters.shift();
			if (waiter === undefined) frames.push(decoded.value);
			else waiter(decoded.value);
		});
		return {
			send: (message): void => {
				transport.send(encodeCollabMessage(message));
			},
			nextFrame: async (): Promise<CollabMessage> => {
				await this.settle();
				const frame = frames.shift();
				if (frame !== undefined) return frame;
				const { promise, resolve } = Promise.withResolvers<CollabMessage>();
				waiters.push(resolve);
				return promise;
			},
			expectNoFrame: async (): Promise<void> => {
				await this.settle();
				if (frames.length > 0) throw new Error('Received an unexpected protocol frame');
			},
			close: (): void => {
				transport.close();
			},
		};
	}

	async #handleFrame(peer: AuthorityPeer, frame: Uint8Array): Promise<void> {
		const decoded = decodeCollabMessage(frame);
		if (!decoded.ok) return;
		const message = decoded.value;
		if (message.type === CollabMessageKind.SyncRequest) {
			peer.server.send(
				encodeCollabMessage({
					type: CollabMessageKind.SyncResponse,
					commit: this.#commit,
					update: Y.encodeStateAsUpdate(this.#doc, message.stateVector),
					stateVector: Y.encodeStateVector(this.#doc),
				}),
			);
			return;
		}
		if (message.type === CollabMessageKind.Proposal) await this.#handleProposal(peer, message);
	}

	async #handleProposal(peer: AuthorityPeer, message: ProposalMessage): Promise<void> {
		const snapshot = {
			roomId: this.roomId,
			commit: this.#commit,
			acceptedProposals: this.#acceptedProposals,
		};
		const pre = preAuthorizationGate(snapshot, message);
		if (pre.kind === GateDecisionKind.ReAcknowledge) {
			this.#send(peer, {
				type: CollabMessageKind.Accepted,
				proposalId: message.proposalId,
				commit: pre.commit,
				update: Y.encodeStateAsUpdate(this.#doc, Y.encodeStateVector(this.#doc)),
				stateVector: Y.encodeStateVector(this.#doc),
			});
			return;
		}
		if (pre.kind === GateDecisionKind.Reject) {
			this.#reject(peer, message, pre.diagnostics);
			return;
		}
		let accepted: ReturnType<typeof readLogicDocument> | undefined;
		if (this.#commit !== 0) accepted = readLogicDocument(this.#doc);
		if (accepted !== undefined && !accepted.ok) throw new Error('Invalid authority state');
		const result = await authorizeProposal({
			proposalId: message.proposalId,
			authoritative: this.#doc,
			acceptedDocument: accepted?.value,
			proposedUpdate: message.update,
			guards: defaultUpdateGuards,
		});
		if (!result.ok) {
			this.#reject(peer, message, result.diagnostics);
			return;
		}
		const fullUpdate = Y.encodeStateAsUpdate(result.value.candidate);
		const post = postAuthorizationGate(
			snapshot,
			message,
			result.value.candidateDocument,
			fullUpdate.byteLength,
		);
		if (post.kind === GateDecisionKind.Reject) {
			result.value.candidate.destroy();
			this.#reject(peer, message, post.diagnostics);
			return;
		}
		const previous = this.#doc;
		const update = Y.encodeStateAsUpdate(result.value.candidate, Y.encodeStateVector(previous));
		this.#commit += 1;
		this.#acceptedProposals.set(message.proposalId, this.#commit);
		this.#doc = result.value.candidate;
		previous.destroy();
		const acceptedFrame = encodeCollabMessage({
			type: CollabMessageKind.Accepted,
			proposalId: message.proposalId,
			commit: this.#commit,
			update,
			stateVector: Y.encodeStateVector(this.#doc),
		});
		for (const current of this.#peers) current.server.send(acceptedFrame);
	}

	#send(peer: AuthorityPeer, message: CollabMessage): void {
		peer.server.send(encodeCollabMessage(message));
	}

	#reject(
		peer: AuthorityPeer,
		message: ProposalMessage,
		diagnostics: readonly {
			readonly code: string;
			readonly message: string;
			readonly path: readonly string[];
		}[],
	): void {
		this.#send(peer, {
			type: CollabMessageKind.Rejected,
			proposalId: message.proposalId,
			diagnostics,
		});
	}
}
