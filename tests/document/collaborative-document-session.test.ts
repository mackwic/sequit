import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TransportStatus } from '../../src/lib/collaboration/collaboration-transport';
import {
	CollabMessageKind,
	decodeCollabMessage,
	encodeCollabMessage,
	ProposalIntent,
} from '../../src/lib/collaboration/protocol';
import { RoomDecisionDiagnosticCode } from '../../src/lib/collaboration/room-decision';
import {
	CollaborationStatus,
	CommitApplication,
	createCollaborativeDocumentSession,
	planCommitApplication,
	type ProposalDecision,
	ProposalDecisionKind,
} from '../../src/lib/document/collaborative-document-session';
import {
	createCollaborativeYDoc,
	readCollaborativeYDoc,
	stateVectorsEqual,
} from '../../src/lib/document/collaborative-session-documents';
import { dispatchSessionFrame } from '../../src/lib/document/collaborative-session-inbound';
import {
	acceptedDecision,
	droppedDecision,
	initializationWasLost,
} from '../../src/lib/document/collaborative-session-model';
import { PendingOperationKind } from '../../src/lib/document/pending-operations';
import { collaborativeDocument, encodeFullUpdate } from '../builders/collaboration';
import { CollaborationAuthority } from '../harnesses/collaboration-authority';
import { createMemoryTransportPair } from '../harnesses/memory-transport';

function markdown(
	session: ReturnType<typeof createCollaborativeDocumentSession>,
	nodeId: string,
): string {
	return session.read().nodes.find(({ id }) => id === nodeId)?.markdown ?? '';
}

async function readySession(roomId = 'session-room') {
	const authority = new CollaborationAuthority(roomId);
	const transport = authority.connect();
	const session = createCollaborativeDocumentSession(collaborativeDocument(roomId), transport);
	await authority.settle();
	return { authority, session, transport };
}

async function initializeAuthority(authority: CollaborationAuthority): Promise<void> {
	const client = authority.scenarioClient();
	client.send({
		type: CollabMessageKind.Proposal,
		proposalId: 'seed',
		intent: ProposalIntent.Initialize,
		update: encodeFullUpdate(collaborativeDocument(authority.roomId)),
	});
	await client.nextFrame();
	client.close();
}

describe('collaborative document session commit planning', () => {
	it('the next contiguous commit is applied', () => {
		expect(planCommitApplication(4, 5)).toBe(CommitApplication.Apply);
	});

	it('an already-known commit is ignored', () => {
		expect(planCommitApplication(4, 4)).toBe(CommitApplication.Ignore);
		expect(planCommitApplication(4, 3)).toBe(CommitApplication.Ignore);
	});

	it('a commit gap requires an incremental resync', () => {
		expect(planCommitApplication(4, 6)).toBe(CommitApplication.IncrementalResync);
	});

	it('creates accepted, dropped, and lost-initialization decisions', () => {
		const decision: ProposalDecision = acceptedDecision(undefined, 2);
		expect(decision).toEqual({
			type: ProposalDecisionKind.Accepted,
			commit: 2,
		});
		expect(
			droppedDecision({
				kind: PendingOperationKind.ReplaceNodeMarkdown,
				nodeId: 'gone',
				markdown: 'Gone',
			}),
		).toMatchObject({
			type: ProposalDecisionKind.OperationDropped,
			diagnostics: [{ code: 'stale-operation-target', path: ['nodes', 'gone'] }],
		});
		expect(initializationWasLost([])).toBe(false);
		expect(
			initializationWasLost([
				{
					code: RoomDecisionDiagnosticCode.RoomAlreadyInitialized,
					message: 'Already initialized',
					path: [],
				},
			]),
		).toBe(true);
	});

	it('dispatches every server frame and malformed input', () => {
		const handlers = {
			malformed: vi.fn(),
			syncResponse: vi.fn(),
			accepted: vi.fn(),
			rejected: vi.fn(),
			protocolError: vi.fn(),
		};
		const messages = [
			{
				type: CollabMessageKind.SyncResponse,
				commit: 0,
				update: new Uint8Array(),
				stateVector: new Uint8Array(),
			},
			{
				type: CollabMessageKind.Accepted,
				commit: 1,
				update: new Uint8Array(),
				stateVector: new Uint8Array(),
			},
			{ type: CollabMessageKind.Rejected, proposalId: 'p', diagnostics: [] },
			{ type: CollabMessageKind.ProtocolError, message: 'failed' },
			{ type: CollabMessageKind.SyncRequest, lastCommit: 0, stateVector: new Uint8Array() },
			{
				type: CollabMessageKind.Proposal,
				proposalId: 'p',
				intent: ProposalIntent.Change,
				update: new Uint8Array(),
			},
		] as const;
		for (const message of messages) dispatchSessionFrame(encodeCollabMessage(message), handlers);
		dispatchSessionFrame(new Uint8Array(), handlers);
		expect(handlers.syncResponse).toHaveBeenCalledOnce();
		expect(handlers.accepted).toHaveBeenCalledOnce();
		expect(handlers.rejected).toHaveBeenCalledOnce();
		expect(handlers.protocolError).toHaveBeenCalledOnce();
		expect(handlers.malformed).toHaveBeenCalledOnce();
	});

	it('rejects invalid collaborative documents and unequal vectors', () => {
		const empty = createCollaborativeYDoc();
		expect(() => readCollaborativeYDoc(empty)).toThrow('Unsupported');
		expect(stateVectorsEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
		expect(stateVectorsEqual(new Uint8Array([1]), new Uint8Array([2]))).toBe(false);
		empty.destroy();
	});
});

describe('collaborative document session', () => {
	it('an edit renders optimistically before any decision', () => {
		const authority = new CollaborationAuthority('optimistic');
		const transport = authority.connect();
		transport.setAutoDeliver(false);
		const session = createCollaborativeDocumentSession(
			collaborativeDocument('optimistic'),
			transport,
		);
		expect(session.replaceNodeMarkdown('source-a', 'Optimistic')).toBe(true);
		expect(markdown(session, 'source-a')).toBe('Optimistic');
		session.destroy();
	});

	it('an empty room is initialized from the local document', async () => {
		const { authority, session } = await readySession('initialize');
		expect(session.connectionStatus()).toBe(CollaborationStatus.Ready);
		expect(authority.commit()).toBe(1);
		expect(authority.readAuthoritative()).toEqual({ ok: true, value: session.read() });
		session.destroy();
	});

	it('joining an initialized room discards the local import', async () => {
		const authority = new CollaborationAuthority('join');
		await initializeAuthority(authority);
		const local = { ...collaborativeDocument('join'), title: 'Must be discarded' };
		const session = createCollaborativeDocumentSession(local, authority.connect());
		await authority.settle();
		expect(session.read().title).not.toBe('Must be discarded');
		session.destroy();
	});

	it('losing the initialization race converges without duplicated content', async () => {
		const authority = new CollaborationAuthority('race');
		const first = createCollaborativeDocumentSession(
			collaborativeDocument('race'),
			authority.connect(),
		);
		const second = createCollaborativeDocumentSession(
			{ ...collaborativeDocument('race'), title: 'Losing import' },
			authority.connect(),
		);
		await authority.settle();
		expect(first.read()).toEqual(second.read());
		expect(authority.commit()).toBe(1);
		first.destroy();
		second.destroy();
	});

	it('a state-vector mismatch recovers through a full resync', async () => {
		const { authority, session, transport } = await readySession('vector-repair');
		transport.setAutoDeliver(false);
		session.replaceNodeMarkdown('source-a', 'Pending repair');
		await authority.settle();
		const acceptedFrame = transport.dropNext();
		if (acceptedFrame === undefined) throw new Error('Expected acceptance');
		const decoded = decodeCollabMessage(acceptedFrame);
		if (!decoded.ok || decoded.value.type !== CollabMessageKind.Accepted)
			throw new Error('Expected acceptance');
		transport.setAutoDeliver(true);
		transport.injectFrame(
			encodeCollabMessage({ ...decoded.value, stateVector: new Uint8Array([0]) }),
		);
		await authority.settle();
		expect(session.connectionStatus()).toBe(CollaborationStatus.Ready);
		session.destroy();
	});

	it('a dropped acceptance is settled by replaying the same proposal id', async () => {
		const { authority, session, transport } = await readySession('replay');
		transport.setAutoDeliver(false);
		session.replaceNodeMarkdown('source-a', 'Once');
		await authority.settle();
		const dropped = transport.dropNext();
		if (dropped === undefined) throw new Error('Expected acceptance');
		transport.setAutoDeliver(true);
		transport.setStatus(TransportStatus.Disconnected);
		transport.setStatus(TransportStatus.Connected);
		await authority.settle();
		expect(authority.commit()).toBe(2);
		expect(markdown(session, 'source-a')).toBe('Once');
		session.destroy();
	});

	it('a rejection rolls back by discarding the candidate', () => {
		const pair = createMemoryTransportPair();
		const session = createCollaborativeDocumentSession(
			collaborativeDocument('reject'),
			pair.client,
		);
		const decisions = vi.fn();
		session.subscribeToDecisions(decisions);
		const requests: Uint8Array[] = [];
		pair.server.subscribeToFrames((frame) => requests.push(frame));
		const update = encodeFullUpdate(collaborativeDocument('reject'));
		const seeded = new Y.Doc();
		Y.applyUpdate(seeded, update);
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.SyncResponse,
				commit: 1,
				update: new Uint8Array(),
				stateVector: new Uint8Array([9]),
			}),
		);
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.SyncResponse,
				commit: 1,
				update,
				stateVector: Y.encodeStateVector(seeded),
			}),
		);
		seeded.destroy();
		session.replaceNodeMarkdown('source-a', 'Rejected');
		const proposalFrame = requests.at(-1);
		if (proposalFrame === undefined) throw new Error('Expected proposal');
		const proposal = decodeCollabMessage(proposalFrame);
		if (!proposal.ok || proposal.value.type !== CollabMessageKind.Proposal)
			throw new Error('Expected proposal');
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.Rejected,
				proposalId: proposal.value.proposalId,
				diagnostics: [{ code: 'refused', message: 'Refused', path: [] }],
			}),
		);
		expect(markdown(session, 'source-a')).not.toBe('Rejected');
		expect(decisions).toHaveBeenCalledWith(
			expect.objectContaining({ type: ProposalDecisionKind.Rejected }),
		);
		session.destroy();
	});

	it('remote commits rebase the pending overlay', async () => {
		const authority = new CollaborationAuthority('rebase');
		const first = createCollaborativeDocumentSession(
			collaborativeDocument('rebase'),
			authority.connect(),
		);
		const secondTransport = authority.connect();
		const second = createCollaborativeDocumentSession(
			collaborativeDocument('rebase'),
			secondTransport,
		);
		await authority.settle();
		secondTransport.setAutoDeliver(false);
		second.replaceNodeMarkdown('source-b', 'Pending B');
		first.replaceNodeMarkdown('source-a', 'Accepted A');
		await authority.settle();
		secondTransport.setAutoDeliver(true);
		await authority.settle();
		expect(markdown(second, 'source-a')).toBe('Accepted A');
		expect(markdown(second, 'source-b')).toBe('Pending B');
		first.destroy();
		second.destroy();
	});

	it('rapid edits coalesce and propose sequentially', async () => {
		const { authority, session, transport } = await readySession('coalesce');
		transport.setAutoDeliver(false);
		session.replaceNodeMarkdown('source-a', 'One');
		session.replaceNodeMarkdown('source-a', 'Two');
		session.replaceNodeMarkdown('source-a', 'Three');
		await authority.settle();
		transport.setAutoDeliver(true);
		await authority.settle();
		expect(authority.commit()).toBe(3);
		expect(markdown(session, 'source-a')).toBe('Three');
		session.destroy();
	});

	it('a stale operation is dropped with a decision', async () => {
		const { session } = await readySession('stale');
		expect(session.replaceNodeMarkdown('missing', 'No target')).toBe(false);
		session.destroy();
	});

	it('duplicate frames are ignored and gaps resynchronize', async () => {
		const { authority, session, transport } = await readySession('gaps');
		transport.injectFrame(
			encodeCollabMessage({
				type: CollabMessageKind.Accepted,
				commit: 5,
				update: new Uint8Array(),
				stateVector: authority.stateVector(),
			}),
		);
		await authority.settle();
		expect(session.connectionStatus()).toBe(CollaborationStatus.Ready);
		session.destroy();
	});

	it('edits while disconnected stay queued and are proposed after reconnection', async () => {
		const { authority, session, transport } = await readySession('offline-queue');
		transport.setStatus(TransportStatus.Disconnected);
		session.replaceNodeMarkdown('source-a', 'Queued');
		expect(authority.commit()).toBe(1);
		transport.setStatus(TransportStatus.Connected);
		await authority.settle();
		expect(authority.commit()).toBe(2);
		session.destroy();
	});

	it('destroy closes the transport and silences listeners', async () => {
		const { session, transport } = await readySession('destroy');
		const subscriber = vi.fn();
		session.subscribe(subscriber);
		session.destroy();
		session.destroy();
		expect(transport.status()).toBe(TransportStatus.Disconnected);
		expect(session.replaceNodeMarkdown('source-a', 'Late')).toBe(false);
		expect(() => session.read()).toThrow('destroyed');
		expect(subscriber).not.toHaveBeenCalled();
	});

	it('projects transport phases, unsubscribes, and repairs protocol failures', () => {
		const pair = createMemoryTransportPair();
		pair.client.setStatus(TransportStatus.Connecting);
		const sent: Uint8Array[] = [];
		pair.server.subscribeToFrames((frame) => sent.push(frame));
		const session = createCollaborativeDocumentSession(
			collaborativeDocument('status'),
			pair.client,
		);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Connecting);
		const unsubscribeDocument = session.subscribe(vi.fn());
		const unsubscribeDecision = session.subscribeToDecisions(vi.fn());
		unsubscribeDocument();
		unsubscribeDecision();
		pair.client.setStatus(TransportStatus.Disconnected);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Disconnected);
		pair.client.setStatus(TransportStatus.Connected);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
		const firstSyncCount = sent.length;
		pair.client.injectFrame(new Uint8Array());
		pair.client.injectFrame(
			encodeCollabMessage({ type: CollabMessageKind.ProtocolError, message: 'repair' }),
		);
		expect(sent.length).toBe(firstSyncCount + 2);
		session.destroy();
	});

	it('ignores unrelated decisions and malformed sync responses', async () => {
		const { authority, session, transport } = await readySession('defensive');
		transport.injectFrame(
			encodeCollabMessage({
				type: CollabMessageKind.Rejected,
				proposalId: 'foreign',
				diagnostics: [],
			}),
		);
		transport.injectFrame(
			encodeCollabMessage({
				type: CollabMessageKind.Accepted,
				proposalId: 'foreign',
				commit: 1,
				update: new Uint8Array(),
				stateVector: authority.stateVector(),
			}),
		);
		transport.injectFrame(
			encodeCollabMessage({
				type: CollabMessageKind.SyncResponse,
				commit: 1,
				update: new Uint8Array(),
				stateVector: authority.stateVector(),
			}),
		);
		transport.setStatus(TransportStatus.Disconnected);
		transport.injectFrame(
			encodeCollabMessage({ type: CollabMessageKind.ProtocolError, message: 'offline' }),
		);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Disconnected);
		session.destroy();
	});

	it('repairs a lost initialization and invalid fresh sync payloads', () => {
		const pair = createMemoryTransportPair();
		const sent: Uint8Array[] = [];
		pair.server.subscribeToFrames((frame) => sent.push(frame));
		const session = createCollaborativeDocumentSession(
			collaborativeDocument('initialization-repair'),
			pair.client,
		);
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.SyncResponse,
				commit: 0,
				update: new Uint8Array(),
				stateVector: new Uint8Array([0]),
			}),
		);
		const proposalFrame = sent.at(-1);
		if (proposalFrame === undefined) throw new Error('Expected initialization proposal');
		const proposal = decodeCollabMessage(proposalFrame);
		if (!proposal.ok || proposal.value.type !== CollabMessageKind.Proposal)
			throw new Error('Expected initialization proposal');
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.Rejected,
				proposalId: proposal.value.proposalId,
				diagnostics: [
					{
						code: RoomDecisionDiagnosticCode.RoomAlreadyInitialized,
						message: 'Lost race',
						path: [],
					},
				],
			}),
		);
		pair.server.send(
			encodeCollabMessage({
				type: CollabMessageKind.SyncResponse,
				commit: 1,
				update: new Uint8Array([255]),
				stateVector: new Uint8Array([0]),
			}),
		);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
		session.destroy();
	});

	it('escalates an incremental vector mismatch to a full resync', async () => {
		const { authority, session, transport } = await readySession('incremental-mismatch');
		transport.setAutoDeliver(false);
		transport.setStatus(TransportStatus.Disconnected);
		transport.setStatus(TransportStatus.Connected);
		await authority.settle();
		const response = transport.dropNext();
		if (response === undefined) throw new Error('Expected incremental sync response');
		const decoded = decodeCollabMessage(response);
		if (!decoded.ok || decoded.value.type !== CollabMessageKind.SyncResponse)
			throw new Error('Expected incremental sync response');
		transport.injectFrame(
			encodeCollabMessage({ ...decoded.value, stateVector: new Uint8Array([9]) }),
		);
		expect(session.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
		session.destroy();
	});

	it('reports an initialization rejection before repairing the room state', () => {
		expect(RoomDecisionDiagnosticCode.RoomAlreadyInitialized).toBe('room-already-initialized');
	});
});
