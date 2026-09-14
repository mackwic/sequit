import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TransportStatus } from '../../../../src/lib/infrastructure/collaboration/collaboration-transport';
import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
} from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	type SessionMessage,
	SessionMessageKind as Message,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import {
	readSyncStep,
	SyncStepKind,
	writeSyncRequest,
	writeSyncResponse,
} from '../../../../src/lib/infrastructure/collaboration/sync-steps';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { createMemoryTransportPair } from '../../../support/harnesses/memory-transport';

function setup(initialized = true) {
	const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
	const authoritative = new Y.Doc();
	if (initialized) importLogicDocument(authoritative, initial);
	const pair = createMemoryTransportPair();
	const sent: SessionMessage[] = [];
	pair.server.subscribeToFrames((frame) => {
		sent.push(decodeSessionMessage(frame));
	});
	const client = createCollaborativeDocumentSession(initial, pair.client);
	function receive(message: SessionMessage): void {
		pair.server.send(encodeSessionMessage(message));
	}
	function sync(): void {
		receive({ type: Message.Sync, payload: writeSyncResponse(authoritative) });
		receive({ type: Message.Sync, payload: writeSyncRequest(authoritative) });
	}
	function destroy(): void {
		client.destroy();
		authoritative.destroy();
		pair.server.close();
	}
	return { client, authoritative, pair, sent, receive, sync, destroy };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('collaborative document session', () => {
	it('joins using native sync steps and keeps the same document and texts during remote updates', () => {
		const room = setup();
		expect(room.client.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
		room.sync();
		expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
		const doc = room.client.document;
		const target = { kind: Kind.Node, id: 'A' };
		const text = room.client.text(target, 'markdown');
		expect(text?.toJSON()).toBe('Alpha');
		const changed = vi.fn();
		const stop = room.client.subscribe(changed);
		room.receive({
			type: Message.Commit,
			update: Y.encodeStateAsUpdate(room.authoritative),
			commit: 1,
		});
		expect(room.client.document).toBe(doc);
		expect(room.client.text(target, 'markdown')).toBe(text);
		expect(changed).not.toHaveBeenCalled();
		stop();
		room.destroy();
	});

	it('initializes a room with a single separately identified snapshot, without optimistic initial text', () => {
		const room = setup(false);
		room.sync();
		const initialize = room.sent.find((message) => message.type === Message.Initialize);
		if (initialize?.type !== Message.Initialize) throw new Error('Expected initialization');
		expect(room.client.text({ kind: Kind.Node, id: 'A' }, 'markdown')).toBeUndefined();
		room.receive({ type: Message.Commit, id: initialize.id, update: initialize.update, commit: 1 });
		expect(room.client.read().nodes[0]?.markdown).toBe('Alpha');
		expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
		room.destroy();
	});

	it('displays text immediately and emits an ID-free update after the 50 ms buffer', () => {
		vi.useFakeTimers();
		const room = setup();
		room.sync();
		room.sent.length = 0;
		room.client.replaceNodeMarkdown('A', 'Alpha modifié');
		expect(room.client.read().nodes[0]?.markdown).toBe('Alpha modifié');
		expect(room.sent).toEqual([]);
		vi.advanceTimersByTime(50);
		expect(room.sent).toHaveLength(1);
		const message = room.sent[0];
		expect(message?.type).toBe(Message.Change);
		if (message?.type !== Message.Change || !('update' in message))
			throw new Error('Expected text update');
		expect(message.update).toBeInstanceOf(Uint8Array);
		expect(room.sent[0]).not.toHaveProperty('id');
		room.destroy();
	});

	it('waits for the server before applying structural commands and retries the same command ID after reconnect', () => {
		const room = setup();
		room.sync();
		room.sent.length = 0;
		const commands = [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }] as const;
		const id = room.client.dispatch(commands);
		expect(room.client.read().nodes).toHaveLength(2);
		room.pair.client.setStatus(TransportStatus.Disconnected);
		expect(() => room.client.dispatch(commands)).toThrow();
		room.pair.client.setStatus(TransportStatus.Connected);
		room.sync();
		expect(room.sent.filter((message) => message.type === Message.Change)).toEqual([
			{ type: Message.Change, id, commands },
			{ type: Message.Change, id, commands },
		]);
		const decisions = vi.fn();
		const stop = room.client.subscribeToDecisions(decisions);
		room.receive({
			type: Message.Commit,
			id,
			update: Y.encodeStateAsUpdate(room.authoritative),
			commit: 2,
		});
		expect(decisions).toHaveBeenCalledOnce();
		stop();
		room.destroy();
	});

	it('recovers unsent offline text with the native sync reply', () => {
		vi.useFakeTimers();
		const room = setup();
		room.sync();
		room.sent.length = 0;
		room.pair.client.setStatus(TransportStatus.Disconnected);
		room.client.replaceNodeMarkdown('A', 'Offline');
		vi.advanceTimersByTime(500);
		expect(room.sent).toEqual([]);
		room.pair.client.setStatus(TransportStatus.Connected);
		room.sync();
		const response = room.sent.filter((message) => message.type === Message.Sync).at(-1);
		if (response?.type !== Message.Sync) throw new Error('Expected sync');
		const step = readSyncStep(response.payload);
		if (step.kind !== SyncStepKind.Response) throw new Error('Expected native response');
		expect(step.update.length).toBeGreaterThan(2);
		expect(room.client.read().nodes[0]?.markdown).toBe('Offline');
		room.destroy();
	});

	it('terminates on rejection before notifying the refresh handler and discards the buffer', () => {
		vi.useFakeTimers();
		const room = setup();
		room.sync();
		room.sent.length = 0;
		room.client.replaceNodeMarkdown('A', 'Pending');
		const rejected = vi.fn(() => {
			expect(room.pair.client.status()).toBe(TransportStatus.Disconnected);
		});
		const stop = room.client.subscribeToRejection(rejected);
		room.receive({ type: Message.Reject, message: 'Refus' });
		expect(rejected).toHaveBeenCalledWith('Refus');
		vi.advanceTimersByTime(500);
		expect(room.sent).toEqual([]);
		expect(room.client.replaceNodeMarkdown('A', 'Later')).toBe(false);
		expect(room.client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
		stop();
		room.destroy();
	});

	it('replaces the presence list, including departures', () => {
		const room = setup();
		room.sync();
		const presence = vi.fn();
		const stop = room.client.subscribeToPresence(presence);
		room.client.setPresence({
			name: 'Alice',
			color: '#123456',
			selected: [{ kind: Kind.Node, id: 'A' }],
		});
		room.receive({
			type: Message.Presence,
			participants: [
				{ clientId: 42, name: 'Bob', color: '#abcdef', selected: [{ kind: Kind.Node, id: 'B' }] },
			],
		});
		expect(presence).toHaveBeenLastCalledWith([
			expect.objectContaining({ name: 'Bob', selected: [{ kind: Kind.Node, id: 'B' }] }),
		]);
		room.receive({ type: Message.Presence, participants: [] });
		expect(presence).toHaveBeenLastCalledWith([]);
		stop();
		room.destroy();
	});

	it('fails terminally on malformed frames and tolerates missing/deleted text targets', () => {
		const room = setup();
		expect(room.client.replaceNodeMarkdown('A', 'Before sync')).toBe(false);
		room.sync();
		expect(room.client.replaceNodeMarkdown('missing', 'Missing')).toBe(false);
		const rejection = vi.fn();
		room.client.subscribeToRejection(rejection);
		room.pair.client.injectFrame(new Uint8Array([255]));
		expect(rejection).toHaveBeenCalledOnce();
		room.destroy();
		expect(() => room.client.read()).toThrow();
		room.client.destroy();
	});
});

it('retains the initial read model while connecting, and publishes local presence after reconnect', () => {
	const pair = createMemoryTransportPair();
	pair.client.setStatus(TransportStatus.Connecting);
	const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
	const client = createCollaborativeDocumentSession(initial, pair.client);
	expect(client.read()).toBe(initial);
	expect(client.connectionStatus()).toBe(CollaborationStatus.Connecting);
	const frames: SessionMessage[] = [];
	pair.server.subscribeToFrames((frame) => {
		frames.push(decodeSessionMessage(frame));
	});
	client.setPresence({ name: 'Alice', color: '#123456', selected: [{ kind: Kind.Node, id: 'A' }] });
	expect(frames).toEqual([]);
	pair.client.setStatus(TransportStatus.Disconnected);
	expect(client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
	pair.client.setStatus(TransportStatus.Connected);
	expect(frames.some((frame) => frame.type === Message.Presence)).toBe(true);
	client.destroy();
	client.setPresence({ name: 'Closed', color: '#123456', selected: [] });
	pair.server.close();
});

it('reuses the pending initialization during repeated empty syncs and adopts an already initialized room', () => {
	const room = setup(false);
	room.sync();
	room.sync();
	const initializations = room.sent.filter((message) => message.type === Message.Initialize);
	expect(initializations).toHaveLength(2);
	expect(initializations[0]).toEqual(initializations[1]);
	importLogicDocument(
		room.authoritative,
		collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room'),
	);
	room.sync();
	expect(room.client.read().relations).toHaveLength(1);
	room.destroy();
});

it('merges the textarea composition update locally and ignores edits after shutdown', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const clone = new Y.Doc();
	Y.applyUpdate(clone, Y.encodeStateAsUpdate(room.client.document));
	const node = clone.getMap<Y.Map<unknown>>('sequit.nodes').get('A');
	const text = node?.get('markdown');
	if (!(text instanceof Y.Text)) throw new Error('Expected text');
	text.insert(0, 'Composed ');
	const update = Y.encodeStateAsUpdate(clone, Y.encodeStateVector(room.client.document));
	const received = vi.fn();
	const stop = room.client.subscribe(received);
	room.client.applyLocalTextUpdate(update);
	expect(received).toHaveBeenCalledOnce();
	vi.advanceTimersByTime(50);
	expect(room.sent).toHaveLength(1);
	expect(room.client.text({ kind: Kind.Node, id: 'A' }, 'natureId')).toBeUndefined();
	stop();
	room.destroy();
	room.client.applyLocalTextUpdate(update);
	clone.destroy();
});

it.each([Message.Change, Message.Initialize])(
	'rejects client-only %s frames received from the server',
	(kind) => {
		const room = setup();
		room.sync();
		const reject = vi.fn();
		room.client.subscribeToRejection(reject);
		if (kind === Message.Change)
			room.receive({ type: Message.Change, update: new Uint8Array([0, 0]) });
		else
			room.receive({ type: Message.Initialize, id: 'server-init', update: new Uint8Array([0, 0]) });
		expect(reject).toHaveBeenCalledOnce();
		room.destroy();
	},
);

it('ignores transport callbacks delivered late after destroy', () => {
	const pair = createMemoryTransportPair();
	let frame: ((value: Uint8Array) => void) | undefined;
	let status: ((value: TransportStatus) => void) | undefined;
	vi.spyOn(pair.client, 'subscribeToFrames').mockImplementation((listener) => {
		frame = listener;
		return () => undefined;
	});
	vi.spyOn(pair.client, 'subscribeToStatus').mockImplementation((listener) => {
		status = listener;
		return () => undefined;
	});
	const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
	const client = createCollaborativeDocumentSession(initial, pair.client);
	client.destroy();
	frame?.(new Uint8Array([255]));
	status?.(TransportStatus.Connected);
	expect(client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
	pair.server.close();
});

it('does not publish an incomplete initial document as an editable session', () => {
	const room = setup(false);
	const listener = vi.fn();
	room.client.subscribe(listener);
	const partial = new Y.Doc();
	partial.getMap('meta').set('id', 'room');
	room.receive({ type: Message.Sync, payload: writeSyncResponse(partial) });
	expect(listener).not.toHaveBeenCalled();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
	partial.destroy();
	room.destroy();
});

it('sends buffered typing before deleting the edited node, without a later text batch', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	room.client.replaceNodeMarkdown('A', 'Dernière frappe');
	room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } }]);
	expect(room.sent).toHaveLength(2);
	const [text, command] = room.sent;
	if (text?.type !== Message.Change || !('update' in text))
		throw new Error('Expected the text update before the command');
	expect(text.update).toBeInstanceOf(Uint8Array);
	expect(text).not.toHaveProperty('id');
	expect(command).toMatchObject({
		type: Message.Change,
		commands: [{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } }],
	});
	vi.advanceTimersByTime(500);
	expect(room.sent).toHaveLength(2);
	room.destroy();
});

it('coalesces pointer motion, preserves independent selection fields and clears peers when offline', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	room.client.setPresence({ pointer: { x: 1, y: 2 } });
	room.client.setPresence({ name: 'Alice', selected: [{ kind: Kind.Node, id: 'A' }] });
	room.client.setPresence({ pointer: { x: 30, y: 40 } });
	expect(room.sent).toEqual([]);
	vi.advanceTimersByTime(50);
	expect(room.sent).toEqual([
		{
			type: Message.Presence,
			participants: [
				{
					clientId: room.client.document.clientID,
					name: 'Alice',
					color: '#6f70e8',
					selected: [{ kind: Kind.Node, id: 'A' }],
					pointer: { x: 30, y: 40 },
				},
			],
		},
	]);
	const peers = vi.fn();
	room.client.subscribeToPresence(peers);
	room.receive({
		type: Message.Presence,
		participants: [{ clientId: 42, name: 'Bob', color: '#123456', selected: [] }],
	});
	room.pair.client.setStatus(TransportStatus.Disconnected);
	expect(peers).toHaveBeenLastCalledWith([]);
	room.client.setPresence({ pointer: null });
	room.destroy();
	vi.advanceTimersByTime(50);
});
