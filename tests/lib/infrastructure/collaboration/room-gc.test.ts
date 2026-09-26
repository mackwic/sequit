import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { authorizeProposal } from '../../../../src/lib/infrastructure/collaboration/authorize-proposal';
import { compactRoomDocument } from '../../../../src/lib/infrastructure/collaboration/compact-room-document';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { defaultUpdateGuards } from '../../../../src/lib/infrastructure/collaboration/update-guards';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

function text(doc: Y.Doc, id = 'A'): Y.Text {
	const value = doc.getMap<Y.Map<unknown>>('sequit.nodes').get(id)?.get('markdown');
	if (!(value instanceof Y.Text)) throw new Error('Expected fixture text');
	return value;
}

function clone(doc: Y.Doc): Y.Doc {
	const result = new Y.Doc();
	Y.applyUpdate(result, Y.encodeStateAsUpdate(doc));
	return result;
}

async function accept(server: Y.Doc, client: Y.Doc): Promise<void> {
	const current = readLogicDocument(server);
	if (!current.ok) throw new Error('Invalid accepted document');
	const result = await authorizeProposal({
		authoritative: server,
		acceptedDocument: current.value,
		proposedUpdate: Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)),
		guards: defaultUpdateGuards,
		textOnly: true,
	});
	if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
	try {
		compactRoomDocument(result.value.candidate);
		Y.applyUpdate(
			server,
			Y.encodeStateAsUpdate(result.value.candidate, Y.encodeStateVector(server)),
		);
		compactRoomDocument(server);
	} finally {
		result.value.candidate.destroy();
	}
}

it('keeps a room small through 600 insert/delete cycles and merges an old offline replica', async () => {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, collaborativeFixture(CollaborativeFixture.TwoBoxes, 'gc-room'));
	const client = clone(server);
	const offline = clone(server);
	for (let cycle = 0; cycle < 600; cycle++) {
		text(client).insert(0, 'x'.repeat(16 * 1024));
		await accept(server, client);
		text(client).delete(0, 16 * 1024);
		await accept(server, client);
	}
	expect(text(server).toJSON()).toBe('Alpha');
	expect(Y.encodeStateAsUpdate(server).byteLength).toBeLessThan(10_000);
	text(offline).insert(0, 'Offline ');
	await accept(server, offline);
	Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
	Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
	expect(text(server).toJSON()).toBe('Offline Alpha');
	expect(text(client).toJSON()).toBe(text(offline).toJSON());
	for (const doc of [server, client, offline]) doc.destroy();
});

it('preserves local text undo/redo after server GC without undoing a remote participant', async () => {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, collaborativeFixture(CollaborativeFixture.TwoBoxes, 'undo-room'));
	const alice = clone(server);
	const bob = clone(server);
	const local = Symbol('alice');
	const undo = new Y.UndoManager(text(alice), { trackedOrigins: new Set([local]) });
	alice.transact(() => {
		text(alice).delete(0, 5);
	}, local);
	await accept(server, alice);
	text(bob, 'B').insert(0, 'Bob ');
	await accept(server, bob);
	Y.applyUpdate(alice, Y.encodeStateAsUpdate(server));
	undo.undo();
	await accept(server, alice);
	expect(text(server).toJSON()).toBe('Alpha');
	expect(text(server, 'B').toJSON()).toBe('Bob Bravo');
	undo.redo();
	await accept(server, alice);
	expect(text(server).toJSON()).toBe('');
	expect(text(server, 'B').toJSON()).toBe('Bob Bravo');
	undo.destroy();
	for (const doc of [server, alice, bob]) doc.destroy();
});

it('refuses repeated deleted-node text without growing a compacted restored room', async () => {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, collaborativeFixture(CollaborativeFixture.TwoBoxes, 'boundary-room'));
	const client = clone(server);
	text(client).insert(0, 'Late ');
	server.getMap('sequit.nodes').delete('A');
	compactRoomDocument(server);
	const restored = new Y.Doc({ gc: false });
	Y.applyUpdate(restored, Y.encodeStateAsUpdate(server));
	const before = Y.encodeStateAsUpdate(restored).byteLength;
	for (let attempt = 0; attempt < 24; attempt++) {
		text(client).insert(0, 'x'.repeat(8_192));
		await expect(accept(restored, client)).rejects.toThrow();
	}
	expect(Y.encodeStateAsUpdate(restored).byteLength).toBe(before);
	expect(restored.getMap('sequit.nodes').has('A')).toBe(false);
	expect(readLogicDocument(restored)).toMatchObject({ ok: true });
	client.destroy();
	server.destroy();
	restored.destroy();
});

it('still rejects hidden structural updates after garbage collection', async () => {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, collaborativeFixture(CollaborativeFixture.TwoBoxes, 'boundary-room'));
	const client = clone(server);
	const hidden = new Y.Map();
	client.getMap('hidden').set('payload', hidden);
	hidden.set('structure', 'smuggled');
	client.getMap('hidden').delete('payload');
	compactRoomDocument(server);
	await expect(accept(server, client)).rejects.toThrow();
	expect(server.getMap('hidden').size).toBe(0);
	client.destroy();
	server.destroy();
});

it('rejects an obsolete group label after the ungrouped room has been compacted', async () => {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, collaborativeFixture(CollaborativeFixture.OpenGroup, 'ungroup-room'));
	const client = clone(server);
	const label = client.getMap<Y.Map<unknown>>('sequit.groups').get('G')?.get('label');
	if (!(label instanceof Y.Text)) throw new Error('Expected grouped fixture label');
	label.insert(0, 'Late ');
	executeSharedCommands(server, [{ op: SharedCommandKind.Ungroup, id: 'G' }]);
	compactRoomDocument(server);
	await expect(accept(server, client)).rejects.toThrow();
	expect(server.getMap('sequit.groups').has('G')).toBe(false);
	client.destroy();
	server.destroy();
});
