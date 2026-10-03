import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createCollaborativeDocumentSession } from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session';
import {
	CommandRefusalCode,
	ConflictCode,
} from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	type SessionMessage,
	SessionMessageKind as Message,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
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

/** A synchronized session whose room accepts or refuses the last structural proposal on demand. */
function joinedRoom() {
	const initial = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'room');
	const authoritative = new Y.Doc({ gc: false });
	importLogicDocument(authoritative, initial);
	const pair = createMemoryTransportPair();
	const sent: SessionMessage[] = [];
	pair.server.subscribeToFrames((frame) => {
		sent.push(decodeSessionMessage(frame));
	});
	const client = createCollaborativeDocumentSession(initial, pair.client);
	let commit = 1;
	function receive(message: SessionMessage): void {
		pair.server.send(encodeSessionMessage(message));
	}
	function sync(): void {
		receive({ type: Message.Sync, payload: writeSyncResponse(authoritative) });
		receive({ type: Message.Sync, payload: writeSyncRequest(authoritative) });
	}
	sync();
	function proposals() {
		return sent.filter((message) => message.type === Message.Change && 'commands' in message);
	}
	function lastProposal() {
		const proposal = proposals().at(-1);
		if (proposal?.type !== Message.Change || !('commands' in proposal))
			throw new Error('Expected a structural proposal');
		return proposal;
	}
	function accept(): void {
		const { id, commands } = lastProposal();
		executeSharedCommands(authoritative, commands);
		commit += 1;
		receive({ type: Message.Commit, id, commit, update: Y.encodeStateAsUpdate(authoritative) });
	}
	/** The room refuses as a conflict, after which the session synchronizes again. */
	async function refuse(): Promise<void> {
		receive({
			type: Message.Conflict,
			code: ConflictCode.CommandConflict,
			reason: { code: CommandRefusalCode.ElementsDifferentGroup },
			id: lastProposal().id,
			lastAcceptedSequence: proposals().length - 1,
		});
		// The history hears the refusal from the settled dispatch.
		await Promise.resolve();
		sync();
	}
	function remote(change: (document: Y.Doc) => void): void {
		change(authoritative);
		commit += 1;
		receive({ type: Message.Commit, commit, update: Y.encodeStateAsUpdate(authoritative) });
	}
	function destroy(): void {
		client.destroy();
		authoritative.destroy();
		pair.server.close();
	}
	return { client, proposals, accept, refuse, remote, destroy };
}

const deleteB = [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }] as const;

afterEach(() => {
	vi.useRealTimers();
});

it('undoes and redoes its own batches through the room, waiting for each commit', () => {
	const room = joinedRoom();
	const { history } = room.client;
	expect(history.availability()).toEqual({ undo: false, redo: false });
	void room.client.dispatch(deleteB);
	room.accept();
	expect(room.client.read().nodes.map(({ id }) => id)).toEqual(['A']);
	expect(history.availability()).toEqual({ undo: true, redo: false });

	expect(history.undo()).toBe(true);
	// The room decides an undo like any batch: nothing changes before its commit.
	expect(history.availability()).toEqual({ undo: false, redo: false });
	expect(room.client.read().nodes.map(({ id }) => id)).toEqual(['A']);
	room.accept();
	expect(room.client.read().nodes.find(({ id }) => id === 'B')?.markdown).toBe('Bravo');
	expect(room.client.read().relations).toEqual([{ id: 'R', from: 'B', to: 'A' }]);
	expect(history.availability()).toEqual({ undo: false, redo: true });

	expect(history.redo()).toBe(true);
	room.accept();
	expect(room.client.read().nodes.map(({ id }) => id)).toEqual(['A']);
	expect(history.availability()).toEqual({ undo: true, redo: false });
	room.destroy();
});

it('keeps others’ commits out of its history and skips a step they already reverted', () => {
	const room = joinedRoom();
	const { history } = room.client;
	room.remote((document) => {
		document.getMap<Y.Map<unknown>>('sequit.nodes').get('A')?.set('color', '#123456');
	});
	expect(history.availability()).toEqual({ undo: false, redo: false });
	void room.client.dispatch([
		{ op: Op.Update, target: { kind: Kind.Node, id: 'B' }, set: { color: '#abcdef' }, unset: [] },
	]);
	room.accept();
	room.remote((document) => {
		document.getMap<Y.Map<unknown>>('sequit.nodes').get('B')?.delete('color');
	});
	const proposed = room.proposals().length;
	expect(history.undo()).toBe(false);
	expect(room.proposals()).toHaveLength(proposed);
	expect(history.availability()).toEqual({ undo: false, redo: false });
	room.destroy();
});

it('drops a refused undo, and a new step clears the steps to redo', async () => {
	const room = joinedRoom();
	const { history } = room.client;
	void room.client.dispatch(deleteB);
	room.accept();
	expect(history.undo()).toBe(true);
	await room.refuse();
	expect(history.availability()).toEqual({ undo: false, redo: false });
	expect(room.client.read().nodes.map(({ id }) => id)).toEqual(['A']);

	void room.client.dispatch([
		{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { color: '#abcdef' }, unset: [] },
	]);
	room.accept();
	expect(history.undo()).toBe(true);
	room.accept();
	expect(history.availability()).toEqual({ undo: false, redo: true });
	void room.client.dispatch([
		{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { icon: 'none' }, unset: [] },
	]);
	room.accept();
	expect(history.availability()).toEqual({ undo: true, redo: false });
	room.destroy();
});

it('gathers consecutive edits of one field into a step restored as text, not as a batch', () => {
	vi.useFakeTimers();
	const room = joinedRoom();
	const { history } = room.client;
	const target = { kind: Kind.Node, id: 'A' } as const;
	const markdown = () => room.client.read().nodes.find(({ id }) => id === 'A')?.markdown;
	room.client.updateText(target, 'markdown', 'Alpha one');
	room.client.updateText(target, 'markdown', 'Alpha two');
	room.client.updateText({ kind: Kind.Node, id: 'B' }, 'markdown', 'Bravo one');
	const proposed = room.proposals().length;

	expect(history.undo()).toBe(true);
	expect(room.client.read().nodes.find(({ id }) => id === 'B')?.markdown).toBe('Bravo');
	expect(markdown()).toBe('Alpha two');
	expect(history.undo()).toBe(true);
	expect(markdown()).toBe('Alpha');
	expect(history.availability()).toEqual({ undo: false, redo: true });
	expect(history.redo()).toBe(true);
	expect(markdown()).toBe('Alpha two');
	expect(room.proposals()).toHaveLength(proposed);
	room.destroy();
});
