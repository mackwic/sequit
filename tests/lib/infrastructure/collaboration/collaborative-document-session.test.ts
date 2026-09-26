import { encode } from 'cborg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TransportStatus } from '../../../../src/lib/infrastructure/collaboration/collaboration-transport';
import {
	CollaborationStatus,
	createCollaborativeDocumentSession,
	readSourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import type { SourceDocumentState } from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session-types';
import {
	ConflictCode,
	RetryableSessionFailure,
	SessionFailureCode,
} from '../../../../src/lib/infrastructure/collaboration/session-failure';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	SESSION_WIRE_VERSION,
	type SessionMessage,
	SessionMessageKind as Message,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	writeSyncRequest,
	writeSyncResponse,
} from '../../../../src/lib/infrastructure/collaboration/sync-steps';
import { applyTextUpdate } from '../../../../src/lib/infrastructure/collaboration/text-update-validation';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { createMemoryTransportPair } from '../../../support/harnesses/memory-transport';

function setup(initialized = true, offlineTextEditing = false) {
	const initial = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room');
	const authoritative = new Y.Doc({ gc: false });
	if (initialized) importLogicDocument(authoritative, initial);
	const pair = createMemoryTransportPair();
	const sent: SessionMessage[] = [];
	pair.server.subscribeToFrames((frame) => {
		sent.push(decodeSessionMessage(frame));
	});
	const client = createCollaborativeDocumentSession(initial, pair.client, { offlineTextEditing });
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
	vi.unstubAllGlobals();
});

it('keeps command identity and locks text editing during a retryable service failure', () => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const id = room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
	const original = room.sent[0];
	const failure = new RetryableSessionFailure(SessionFailureCode.StorageUnavailable, 'Retry');
	room.receive({
		type: Message.Retry,
		code: failure.code,
		message: failure.message,
	});
	expect(room.client.replaceNodeMarkdown('A', 'Blocked')).toBe(false);
	room.client.setPresence({ selected: [{ kind: Kind.Node, id: 'A' }] });
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
	vi.advanceTimersByTime(50);
	expect(room.sent.at(-1)?.type).toBe(Message.Presence);
	vi.advanceTimersByTime(950);
	expect(room.sent.some((message) => message.type === Message.Sync)).toBe(true);
	room.sync();
	expect(
		room.sent.filter((message) => message.type === Message.Change && 'commands' in message),
	).toEqual([original, original]);
	expect(room.client.read().nodes[0]?.markdown).toBe('Alpha');
	expect(room.client.replaceNodeMarkdown('A', 'After retry')).toBe(true);
	expect(
		room.sent.some(
			(message) => message.type === Message.Change && 'id' in message && message.id === id,
		),
	).toBe(true);
	room.destroy();
});

it('does not send a text proposal when the requested content already matches', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	expect(room.client.replaceNodeMarkdown('A', 'Alpha')).toBe(true);
	vi.advanceTimersByTime(50);
	expect(room.sent.some((frame) => frame.type === Message.Change && 'update' in frame)).toBe(false);
	room.destroy();
});

it('resends a queued text gesture before syncing after a transient retry', () => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
	const room = setup();
	room.sync();
	room.sent.length = 0;
	expect(room.client.replaceNodeMarkdown('A', 'Buffered before outage')).toBe(true);
	room.receive({
		type: Message.Retry,
		code: SessionFailureCode.StorageUnavailable,
		message: 'Retry',
	});
	vi.advanceTimersByTime(50);
	expect(room.sent.some((frame) => frame.type === Message.Change && 'update' in frame)).toBe(false);
	vi.advanceTimersByTime(950);
	const queued = room.sent.find((frame) => frame.type === Message.Change && 'update' in frame);
	if (queued?.type !== Message.Change || !('update' in queued) || queued.id === undefined)
		throw new Error('Expected an identified text proposal before synchronization');
	expect(room.sent.some((frame) => frame.type === Message.Sync)).toBe(false);
	applyTextUpdate(room.authoritative, queued.update);
	room.receive({
		type: Message.Commit,
		id: queued.id,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	expect(room.sent.some((frame) => frame.type === Message.Sync)).toBe(true);
	room.sync();
	const result = readLogicDocument(room.authoritative);
	if (!result.ok) throw new Error('Expected synchronized document');
	expect(result.value.nodes.find((node) => node.id === 'A')?.markdown).toBe(
		'Buffered before outage',
	);
	room.destroy();
});

it('refuses only the stale command and renumbers the next gesture without closing', () => {
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const decisions = vi.fn();
	room.client.subscribeToDecisions(decisions);
	const first = room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
	const second = room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } }]);
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.CommandConflict,
		message: 'Élément déplacé',
		id: first,
		lastAcceptedSequence: 0,
	});
	expect(room.pair.client.status()).toBe(TransportStatus.Connected);
	expect(decisions).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'refused', proposalId: first }),
	);
	room.sync();
	expect(
		room.sent.filter((message) => message.type === Message.Change && 'commands' in message).at(-1),
	).toMatchObject({ id: second, sequence: 1 });
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	room.destroy();
});

it('flushes on target switch then resets a stale replica without replaying unacknowledged edits', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const original = room.client.document;
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.client.replaceNodeMarkdown('B', 'Brouillon perdu');
	room.client.replaceNodeMarkdown('A', 'Saisie non acquittée');
	const stale = room.sent.find((message) => message.type === Message.Change && 'update' in message);
	if (stale?.type !== Message.Change || !('update' in stale) || stale.id === undefined)
		throw new Error('Expected flushed B text proposal');
	expect(stale.target).toEqual({ kind: Kind.Node, id: 'B' });
	vi.advanceTimersByTime(50);
	expect(
		room.sent.filter((frame) => frame.type === Message.Change && 'update' in frame),
	).toHaveLength(1);
	room.authoritative.getMap('sequit.nodes').delete('B');
	room.receive({
		type: Message.Commit,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.client.applyLocalTextUpdate({ kind: Kind.Node, id: 'B' }, 'markdown', stale.update);
	expect(room.client.read().nodes[0]?.markdown).toBe('Saisie non acquittée');
	expect(notices).not.toHaveBeenCalled();
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: stale.id,
		target: stale.target,
		message: 'Boîte supprimée',
	});
	expect(room.client.document).not.toBe(original);
	expect(room.client.replica()).toBe(1);
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Synchronizing);
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('B, A'));
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: stale.id,
		target: stale.target,
		message: 'Late duplicate',
	});
	expect(notices).toHaveBeenCalledTimes(1);
	expect(room.client.replica()).toBe(1);
	room.sync();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	expect(room.client.read().nodes).toMatchObject([{ id: 'A', markdown: 'Alpha' }]);
	expect(room.client.replaceNodeMarkdown('A', 'Encore modifiable')).toBe(true);
	room.destroy();
});

it('names the document title when its sole pending edit is refused as stale', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.client.updateText({ kind: Kind.Document, id: 'room' }, 'title', 'Titre abandonné');
	vi.advanceTimersByTime(50);
	const stale = room.sent.find((message) => message.type === Message.Change && 'update' in message);
	if (stale?.type !== Message.Change || !('update' in stale) || stale.id === undefined)
		throw new Error('Expected title proposal');
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: stale.id,
		target: stale.target,
		message: 'Titre remplacé',
	});
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('titre du document'));
	room.sync();
	expect(room.client.read().title).toBe('Deux boîtes');
	room.destroy();
});

it('does not apply a stale Quill binding to a node recreated with the same identifier', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const target = { kind: Kind.Node, id: 'A' } as const;
	const old = room.client.text(target, 'markdown');
	if (!(old instanceof Y.Text)) throw new Error('Expected old editor binding');
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	executeSharedCommands(room.authoritative, [
		{ op: Op.Delete, target },
		{ op: Op.Create, target, properties: { natureId: 'N', markdown: 'Fresh incarnation' } },
	]);
	room.receive({
		type: Message.Commit,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	const current = room.client.text(target, 'markdown');
	expect(current).not.toBe(old);
	expect(room.client.updateText(target, 'markdown', 'Old editor content', old)).toBe(false);
	room.client.applyLocalTextUpdate(
		target,
		'markdown',
		Y.encodeStateAsUpdate(room.authoritative),
		old,
	);
	vi.advanceTimersByTime(50);
	expect(
		room.sent.filter((message) => message.type === Message.Change && 'update' in message),
	).toEqual([]);
	expect(room.client.read().nodes.find(({ id }) => id === 'A')?.markdown).toBe('Fresh incarnation');
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('boîte A'));
	expect(room.client.updateText(target, 'markdown', 'New editor content', current)).toBe(true);
	vi.advanceTimersByTime(50);
	const proposal = room.sent.find(
		(message) => message.type === Message.Change && 'update' in message,
	);
	if (proposal?.type !== Message.Change || !('textId' in proposal))
		throw new Error('Expected new binding edit');
	applyTextUpdate(room.authoritative, proposal.update, proposal);
	const authoritative = readLogicDocument(room.authoritative);
	if (!authoritative.ok) throw new Error('Expected valid shared document');
	expect(authoritative.value.nodes.find(({ id }) => id === 'A')?.markdown).toBe(
		'New editor content',
	);
	room.destroy();
});

it.each([
	['group', Kind.Group, 'G'],
	['nature', Kind.Nature, 'N'],
] as const)('drops a stale %s label edit after a legal reincarnation', (_, kind, id) => {
	vi.useFakeTimers();
	const room = setup();
	if (kind === Kind.Group)
		executeSharedCommands(room.authoritative, [
			{ op: Op.Group, id, label: 'Ancien groupe', members: ['A', 'B'] },
		]);
	room.sync();
	room.sent.length = 0;
	const target = { kind, id };
	const old = room.client.text(target, 'label');
	if (!(old instanceof Y.Text)) throw new Error('Expected old label editor');
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	if (kind === Kind.Group) {
		executeSharedCommands(room.authoritative, [
			{ op: Op.Ungroup, id },
			{ op: Op.Group, id, label: 'Nouveau groupe', members: ['A', 'B'] },
		]);
	} else {
		executeSharedCommands(room.authoritative, [
			{
				op: Op.Create,
				target: { kind: Kind.Nature, id: 'M' },
				properties: { label: 'Autre', color: '#00aa44' },
			},
			{ op: Op.Delete, target: { kind: Kind.Nature, id }, replacementId: 'M' },
			{
				op: Op.Create,
				target: { kind: Kind.Nature, id },
				properties: { label: 'Nouvelle nature', color: '#00aa44' },
			},
		]);
	}
	room.receive({
		type: Message.Commit,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	expect(room.client.text(target, 'label')).not.toBe(old);
	expect(room.client.updateText(target, 'label', 'Saisie de l’ancien éditeur', old)).toBe(false);
	vi.advanceTimersByTime(50);
	expect(
		room.sent.filter((message) => message.type === Message.Change && 'update' in message),
	).toEqual([]);
	let label = 'nature';
	if (kind === Kind.Group) label = 'groupe';
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`${label} ${id}`));
	const document = room.client.read();
	if (kind === Kind.Group)
		expect(document.groups.find((group) => group.id === id)?.label).toBe('Nouveau groupe');
	else expect(document.natures.find((nature) => nature.id === id)?.label).toBe('Nouvelle nature');
	room.destroy();
});

it('discards an unsent document-title edit when an earlier box batch is refused', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.client.replaceNodeMarkdown('B', 'Boîte à abandonner');
	room.client.updateText({ kind: Kind.Document, id: 'room' }, 'title', 'Titre non acquitté');
	vi.advanceTimersByTime(50);
	const first = room.sent.find((message) => message.type === Message.Change && 'update' in message);
	if (first?.type !== Message.Change || !('update' in first) || first.id === undefined)
		throw new Error('Expected flushed box text');
	expect(first.target).toEqual({ kind: Kind.Node, id: 'B' });
	room.authoritative.getMap('sequit.nodes').delete('B');
	room.receive({
		type: Message.Commit,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: first.id,
		target: first.target,
		message: 'Deleted',
	});
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('boîtes B'));
	room.sync();
	expect(room.client.read().title).toBe('Deux boîtes');
	expect(room.client.read().nodes.map(({ id }) => id)).toEqual(['A']);
	room.destroy();
});

it('does not replay an acknowledged edit over a remote replacement after losing another target', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	room.client.replaceNodeMarkdown('A', 'AlPHa');
	vi.advanceTimersByTime(50);
	const accepted = room.sent.find(
		(message) => message.type === Message.Change && 'update' in message,
	);
	if (accepted?.type !== Message.Change || !('update' in accepted) || accepted.id === undefined)
		throw new Error('Expected text proposal');
	applyTextUpdate(room.authoritative, accepted.update);
	room.receive({
		type: Message.Commit,
		id: accepted.id,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.client.replaceNodeMarkdown('B', 'Pending');
	vi.advanceTimersByTime(50);
	const stale = room.sent
		.filter((message) => message.type === Message.Change && 'update' in message)
		.at(-1);
	if (stale?.type !== Message.Change || !('update' in stale) || stale.id === undefined)
		throw new Error('Expected B proposal');
	const authoritative = room.authoritative
		.getMap<Y.Map<unknown>>('sequit.nodes')
		.get('A')
		?.get('markdown');
	if (!(authoritative instanceof Y.Text)) throw new Error('Expected surviving text');
	authoritative.delete(0, authoritative.length);
	authoritative.insert(0, 'Remote replacement');
	room.authoritative.getMap('sequit.nodes').delete('B');
	room.receive({
		type: Message.Commit,
		commit: 3,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: stale.id,
		target: stale.target,
		message: 'Deleted',
	});
	room.sync();
	expect(room.client.read().nodes).toMatchObject([{ id: 'A', markdown: 'Remote replacement' }]);
	expect(readSourceDocumentState(room.authoritative, 0)).toMatchObject({
		kind: SourceDocumentStateKind.Valid,
		document: { nodes: [{ id: 'A', markdown: 'Remote replacement' }] },
	});
	room.destroy();
});

it('ignores a delayed refusal for a proposal that is no longer pending', () => {
	const room = setup();
	room.sync();
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.receive({
		type: Message.Conflict,
		id: 'obsolete-proposal',
		code: ConflictCode.CommandConflict,
		message: 'Rejected earlier',
		lastAcceptedSequence: 0,
	});
	expect(notices).not.toHaveBeenCalled();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	expect(room.client.replaceNodeMarkdown('A', 'Still connected')).toBe(true);
	room.destroy();
});

it('keeps a newer same-field edit pending when an older receipt arrives', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.client.replaceNodeMarkdown('A', 'First');
	vi.advanceTimersByTime(50);
	const first = room.sent.at(-1);
	if (first?.type !== Message.Change || !('update' in first) || first.id === undefined)
		throw new Error('Expected first text proposal');
	room.client.replaceNodeMarkdown('A', 'Second');
	vi.advanceTimersByTime(50);
	room.receive({
		type: Message.Commit,
		id: first.id,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.authoritative.getMap('sequit.nodes').delete('A');
	room.receive({
		type: Message.Commit,
		commit: 3,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	const newer = room.sent
		.filter((message) => message.type === Message.Change && 'update' in message)
		.at(-1);
	if (newer?.type !== Message.Change || !('update' in newer) || newer.id === undefined)
		throw new Error('Expected newer proposal');
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: newer.id,
		target: newer.target,
		message: 'Deleted',
	});
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('A'));
	room.destroy();
});

it('announces one deleted box even when two of its text fields had pending edits', () => {
	const room = setup();
	room.sync();
	const notices = vi.fn();
	room.client.subscribeToConflict(notices);
	room.client.updateText({ kind: Kind.Node, id: 'B' }, 'markdown', 'Pending body');
	room.client.updateText({ kind: Kind.Node, id: 'B' }, 'description', 'Pending description');
	const first = room.sent.find((message) => message.type === Message.Change && 'update' in message);
	if (first?.type !== Message.Change || !('update' in first) || first.id === undefined)
		throw new Error('Expected first field');
	room.authoritative.getMap('sequit.nodes').delete('B');
	room.receive({
		type: Message.Commit,
		commit: 2,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	room.receive({
		type: Message.Conflict,
		code: ConflictCode.TextTargetGone,
		id: first.id,
		target: first.target,
		message: 'Deleted',
	});
	expect(notices).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('B'));
	room.destroy();
});

it('backs off with jitter and stops only after six failed resynchronizations', () => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5);
	const room = setup();
	room.sync();
	const rejected = vi.fn();
	room.client.subscribeToRejection(rejected);
	for (const [attempt, delay] of [1_000, 2_000, 4_000, 8_000, 16_000, 16_000].entries()) {
		room.sent.length = 0;
		room.receive({
			type: Message.Retry,
			code: SessionFailureCode.StorageUnavailable,
			message: 'Service unavailable',
		});
		room.receive({
			type: Message.Commit,
			commit: attempt + 2,
			update: Y.encodeStateAsUpdate(room.authoritative),
		});
		vi.advanceTimersByTime(delay - 1);
		expect(room.sent.some((message) => message.type === Message.Sync)).toBe(false);
		vi.advanceTimersByTime(1);
		expect(room.sent.some((message) => message.type === Message.Sync)).toBe(true);
		room.sync();
	}
	room.receive({
		type: Message.Retry,
		code: SessionFailureCode.StorageUnavailable,
		message: 'Service unavailable',
	});
	expect(rejected).toHaveBeenCalledOnce();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
	room.destroy();
});

it('staggers two peers retrying the same transient outage', () => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1);
	const alice = setup();
	const bob = setup();
	alice.sync();
	bob.sync();
	alice.sent.length = 0;
	bob.sent.length = 0;
	for (const room of [alice, bob])
		room.receive({
			type: Message.Retry,
			code: SessionFailureCode.StorageUnavailable,
			message: 'Outage',
		});
	vi.advanceTimersByTime(750);
	expect(alice.sent.some((message) => message.type === Message.Sync)).toBe(true);
	expect(bob.sent.some((message) => message.type === Message.Sync)).toBe(false);
	vi.advanceTimersByTime(500);
	expect(bob.sent.some((message) => message.type === Message.Sync)).toBe(true);
	alice.destroy();
	bob.destroy();
});

it('edits the shared document title only when the document target identity matches', () => {
	const room = setup();
	room.sync();
	const target = { kind: Kind.Document, id: 'room' };
	const title = room.client.text(target, 'title');
	expect(title).toBeInstanceOf(Y.Text);
	expect(
		room.client.updateText({ kind: Kind.Document, id: 'another-room' }, 'title', 'Wrong'),
	).toBe(false);
	expect(room.client.updateText(target, 'title', 'Renamed')).toBe(true);
	expect(room.client.read().title).toBe('Renamed');
	expect(room.client.text(target, 'title')).toBe(title);
	room.destroy();
});

it('retains only the latest presence while offline and publishes it when the connection returns', () => {
	vi.useFakeTimers();
	const room = setup();
	room.sync();
	room.sent.length = 0;
	room.pair.client.setStatus(TransportStatus.Disconnected);
	room.client.setPresence({ pointer: { x: 1, y: 2 } });
	vi.advanceTimersByTime(50);
	room.client.setPresence({ pointer: { x: 3, y: 4 } });
	vi.advanceTimersByTime(50);
	expect(room.sent).toEqual([]);
	room.pair.client.setStatus(TransportStatus.Connected);
	expect(room.sent.find((message) => message.type === Message.Presence)).toMatchObject({
		participants: [{ pointer: { x: 3, y: 4 } }],
	});
	room.sync();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	room.destroy();
});

it('rejects invalid local gestures without consuming a sequence or poisoning reconnect', () => {
	const room = setup();
	room.sync();
	room.sent.length = 0;
	expect(() => room.client.dispatch([])).toThrow();
	room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
	expect(room.sent[0]).toMatchObject({ type: Message.Change, sequence: 1 });
	room.sync();
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	expect(room.sent.filter((message) => message.type === Message.Change)).toEqual([
		room.sent[0],
		room.sent[0],
	]);
	room.destroy();
});

it('ignores malformed presence fields without rejecting the document session', () => {
	const room = setup();
	room.sync();
	room.pair.server.send(
		encode([
			SESSION_WIRE_VERSION,
			{
				type: Message.Presence,
				participants: [],
				unexpected: true,
			},
		]),
	);
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	expect(room.client.replaceNodeMarkdown('A', 'Still editable')).toBe(true);
	room.destroy();
});

it('isolates failing document, presence, decision and rejection subscribers', () => {
	const room = setup();
	room.sync();
	const reported = vi.fn();
	vi.stubGlobal('reportError', reported);
	const fail = () => {
		throw new Error('Broken view');
	};
	room.client.subscribe(fail);
	const changed = vi.fn();
	room.client.subscribe(changed);
	room.client.subscribeToPresence(fail);
	const presence = vi.fn();
	room.client.subscribeToPresence(presence);
	room.client.subscribeToDecisions(fail);
	const decision = vi.fn();
	room.client.subscribeToDecisions(decision);
	room.client.subscribeToRejection(fail);
	const rejection = vi.fn();
	room.client.subscribeToRejection(rejection);
	room.client.replaceNodeMarkdown('A', 'Local');
	const ownedId = room.client.dispatch([{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
	room.receive({ type: Message.Presence, participants: [] });
	room.receive({
		type: Message.Commit,
		commit: 2,
		id: ownedId,
		update: Y.encodeStateAsUpdate(room.authoritative),
	});
	expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
	expect(changed).toHaveBeenCalledOnce();
	expect(decision).toHaveBeenCalledOnce();
	room.receive({ type: Message.Reject, message: 'Domain rejection' });
	expect(rejection).toHaveBeenCalledWith('Domain rejection');
	expect(presence).toHaveBeenCalled();
	expect(reported).toHaveBeenCalled();
	room.destroy();
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
		expect(message).toHaveProperty('id', expect.any(String));
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
		const replays = room.sent.filter((message) => message.type === Message.Change);
		expect(replays).toHaveLength(2);
		expect(replays[0]).toMatchObject({ id, commands, sequence: 1 });
		expect(replays[1]).toEqual(replays[0]);
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

	it('locks local text while disconnected and allows it again after sync', () => {
		vi.useFakeTimers();
		const room = setup();
		room.sync();
		room.sent.length = 0;
		room.pair.client.setStatus(TransportStatus.Disconnected);
		expect(room.client.replaceNodeMarkdown('A', 'Unavailable')).toBe(false);
		vi.advanceTimersByTime(500);
		expect(room.sent).toEqual([]);
		room.pair.client.setStatus(TransportStatus.Connected);
		room.sync();
		expect(room.client.read().nodes[0]?.markdown).toBe('Alpha');
		expect(room.client.replaceNodeMarkdown('A', 'Online')).toBe(true);
		room.destroy();
	});

	it('keeps workshop-only offline text edits locally and replays them before resynchronizing', () => {
		vi.useFakeTimers();
		const room = setup(true, true);
		room.sync();
		room.sent.length = 0;
		room.pair.client.setStatus(TransportStatus.Disconnected);
		expect(room.client.replaceNodeMarkdown('A', 'Texte A hors ligne')).toBe(true);
		expect(room.client.replaceNodeMarkdown('B', 'Texte B hors ligne')).toBe(true);
		expect(room.client.read().nodes.map(({ markdown }) => markdown)).toEqual([
			'Texte A hors ligne',
			'Texte B hors ligne',
		]);
		vi.advanceTimersByTime(500);
		expect(room.sent).toEqual([]);
		room.pair.client.setStatus(TransportStatus.Connected);
		expect(room.client.replaceNodeMarkdown('A', 'Interdit pendant la reprise')).toBe(false);
		for (let index = 0; index < 2; index++) {
			const proposal = room.sent.find(
				(message) => message.type === Message.Change && 'update' in message,
			);
			if (proposal?.type !== Message.Change || !('update' in proposal) || proposal.id === undefined)
				throw new Error('Expected identified pending offline text');
			Y.applyUpdate(room.authoritative, proposal.update);
			room.sent.splice(room.sent.indexOf(proposal), 1);
			room.receive({
				type: Message.Commit,
				id: proposal.id,
				update: Y.encodeStateAsUpdate(room.authoritative),
				commit: index + 1,
			});
		}
		room.sync();
		expect(room.client.connectionStatus()).toBe(CollaborationStatus.Ready);
		expect(readLogicDocument(room.authoritative)).toMatchObject({
			ok: true,
			value: { nodes: [{ markdown: 'Texte A hors ligne' }, { markdown: 'Texte B hors ligne' }] },
		});
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
	room.client.applyLocalTextUpdate({ kind: Kind.Node, id: 'A' }, 'markdown', update);
	expect(received).toHaveBeenCalledOnce();
	vi.advanceTimersByTime(50);
	expect(room.sent).toHaveLength(1);
	expect(room.client.text({ kind: Kind.Node, id: 'A' }, 'natureId')).toBeUndefined();
	stop();
	room.destroy();
	room.client.applyLocalTextUpdate({ kind: Kind.Node, id: 'A' }, 'markdown', update);
	clone.destroy();
});

it('publishes uninitialized before the first sync and valid when the physical Yjs document arrives', () => {
	const room = setup();
	expect(room.client.readSourceState()).toEqual({
		kind: SourceDocumentStateKind.Uninitialized,
		revision: 0,
	});
	expect(readSourceDocumentState(room.client.document, 0).kind).toBe(
		SourceDocumentStateKind.Invalid,
	);
	const states: SourceDocumentState[] = [];
	const stop = room.client.subscribeToSourceState((state) => states.push(state));
	room.sync();
	expect(states).toHaveLength(1);
	expect(states[0]).toMatchObject({
		kind: SourceDocumentStateKind.Valid,
		revision: 1,
		document: { id: 'room' },
	});
	expect(room.client.readSourceState()).toBe(states[0]);
	stop();
	room.destroy();
});

it('publishes valid, invalid and healed physical Yjs source states in revision order', () => {
	const room = setup();
	room.sync();
	const initial = room.client.readSourceState();
	expect(initial.kind).toBe(SourceDocumentStateKind.Valid);
	const states: SourceDocumentState[] = [];
	const accepted = vi.fn();
	const stopSource = room.client.subscribeToSourceState((state) => states.push(state));
	const stopAccepted = room.client.subscribe(accepted);
	const nodes = room.client.document.getMap<Y.Map<unknown>>('sequit.nodes');
	const node = nodes.get('A');
	if (!node) throw new Error('Expected node A');
	const markdown = node.get('markdown');
	if (!(markdown instanceof Y.Text)) throw new Error('Expected node Markdown');
	room.client.document.transact(() => {
		markdown.insert(0, 'private-node-text ');
		node.set('natureId', 'missing');
		nodes.set('0-broken', new Y.Map());
	});
	const invalid = states[0];
	if (invalid?.kind !== SourceDocumentStateKind.Invalid)
		throw new Error('Expected invalid source state');
	expect(invalid.revision).toBe(initial.revision + 1);
	expect(invalid.snapshot.nodeIds).toEqual(['0-broken', 'A', 'B']);
	expect(invalid.snapshot.id).toBe('room');
	expect(invalid.diagnostics.length).toBeGreaterThan(0);
	expect(invalid.snapshot).not.toHaveProperty('markdown');
	expect(JSON.stringify(invalid.snapshot)).not.toContain('private-node-text');
	expect(accepted).not.toHaveBeenCalled();
	expect(room.client.readSourceState()).toBe(invalid);
	expect(readSourceDocumentState(room.client.document, invalid.revision)).toEqual(invalid);
	room.client.document.transact(() => {
		node.set('natureId', 'N');
		nodes.delete('0-broken');
	});
	const healed = states[1];
	if (healed?.kind !== SourceDocumentStateKind.Valid)
		throw new Error('Expected healed source state');
	expect(healed.revision).toBe(invalid.revision + 1);
	expect(healed.document.nodes.map(({ id }) => id)).toEqual(['A', 'B']);
	expect(accepted).toHaveBeenCalledOnce();
	stopSource();
	stopAccepted();
	room.destroy();
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
	expect(() => client.readSourceState()).toThrow('Document session has been destroyed');
	frame?.(new Uint8Array([255]));
	status?.(TransportStatus.Connected);
	expect(client.connectionStatus()).toBe(CollaborationStatus.Disconnected);
	pair.server.close();
});

it('does not send queued presence when a transport send closes the session synchronously', () => {
	const pair = createMemoryTransportPair();
	pair.client.setStatus(TransportStatus.Disconnected);
	const sent: SessionMessage[] = [];
	const holder: { client?: ReturnType<typeof createCollaborativeDocumentSession> } = {};
	vi.spyOn(pair.client, 'send').mockImplementation((frame) => {
		sent.push(decodeSessionMessage(frame));
		holder.client?.destroy();
	});
	const client = createCollaborativeDocumentSession(
		collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room'),
		pair.client,
	);
	holder.client = client;
	client.setPresence({ selected: [{ kind: Kind.Node, id: 'A' }] });
	pair.client.setStatus(TransportStatus.Connected);
	expect(sent.map(({ type }) => type)).toEqual([Message.Sync]);
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
	expect(text).toHaveProperty('id', expect.any(String));
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
