import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { compactRoomDocument } from '../../../../src/lib/infrastructure/collaboration/compact-room-document';
import { RoomRetiredTexts } from '../../../../src/lib/infrastructure/collaboration/retired-text-evidence';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	applyTextUpdate,
	assertLiveTextTarget,
	TextTargetGoneError,
} from '../../../../src/lib/infrastructure/collaboration/text-update-validation';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { validLogicDocument } from '../../../support/builders/logic-document';

function replicas() {
	const server = new Y.Doc({ gc: false });
	importLogicDocument(server, validLogicDocument());
	const client = new Y.Doc({ gc: false });
	Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
	return { server, client };
}

function node(document: Y.Doc): Y.Map<unknown> {
	const value = document.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-a');
	if (value === undefined) throw new Error('Missing fixture node');
	return value;
}

describe('server text boundary', () => {
	it('accepts edits in existing text fields, including the native sync response', () => {
		const { server, client } = replicas();
		const text = node(client).get('markdown');
		if (!(text instanceof Y.Text)) throw new Error('Missing text');
		text.delete(0, 1);
		text.insert(0, 'Edited s');
		const title = client.getMap(YjsCollection.Meta).get('title');
		if (!(title instanceof Y.Text)) throw new Error('Missing title');
		title.insert(0, 'Shared ');
		expect(() => {
			applyTextUpdate(server, Y.encodeStateAsUpdate(client));
		}).not.toThrow();
		const accepted = node(server).get('markdown');
		if (!(accepted instanceof Y.Text)) throw new Error('Missing accepted text');
		expect(accepted.toJSON()).toBe('Edited source A\n');
		client.destroy();
		server.destroy();
	});

	it('allows current text but refuses fields belonging to another element kind', () => {
		const { server, client } = replicas();
		const text = node(client).get('markdown');
		if (!(text instanceof Y.Text) || text._item === null)
			throw new Error('Missing integrated text');
		text.insert(0, 'Live ');
		const update = Y.decodeUpdate(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
		const reference = {
			target: { kind: Kind.Node, id: 'source-a' },
			field: 'markdown',
			textId: text._item.id,
		};
		const retired = new RoomRetiredTexts();
		expect(retired.liveOrRetired(server, reference, update)).toBe(true);
		expect(() => retired.liveOrRetired(server, { ...reference, field: 'title' }, update)).toThrow();
		expect(() =>
			retired.liveOrRetired(
				server,
				{ ...reference, target: { kind: Kind.Relation, id: 'relation-a' }, field: 'label' },
				update,
			),
		).toThrow();
		client.destroy();
		server.destroy();
	});

	it.each(['property', 'replace-text', 'hidden-map', 'embed', 'delete-node'])(
		'rejects %s through the text channel',
		(attack) => {
			const { server, client } = replicas();
			const text = node(client).get('markdown');
			if (!(text instanceof Y.Text)) throw new Error('Missing text');
			if (attack === 'property') node(client).set('color', '#ff0000');
			if (attack === 'replace-text') node(client).set('markdown', new Y.Text('Replacement'));
			if (attack === 'hidden-map') {
				const hidden = new Y.Map();
				node(client).set('hidden', hidden);
				hidden.set('payload', 'hidden structure');
				node(client).delete('hidden');
			}
			if (attack === 'embed') text.insertEmbed(0, { injected: true });
			if (attack === 'delete-node') client.getMap(YjsCollection.Nodes).delete('source-a');
			expect(() => {
				applyTextUpdate(server, Y.encodeStateAsUpdate(client));
			}).toThrow();
			client.destroy();
			server.destroy();
		},
	);

	it('refuses an obsolete text incarnation after deletion, compaction and legal ID reuse', () => {
		const { server, client } = replicas();
		const old = node(client).get('markdown');
		if (!(old instanceof Y.Text) || old._item === null) throw new Error('Expected integrated text');
		old.insert(0, 'Late ');
		const reference = {
			target: { kind: Kind.Node as const, id: 'source-a' },
			field: 'markdown',
			textId: { client: old._item.id.client, clock: old._item.id.clock },
		};
		expect(() => {
			assertLiveTextTarget(server, reference);
		}).not.toThrow();
		executeSharedCommands(server, [{ op: Op.Delete, target: reference.target }]);
		compactRoomDocument(server);
		expect(() => {
			assertLiveTextTarget(server, reference);
		}).toThrow(TextTargetGoneError);
		executeSharedCommands(server, [
			{
				op: Op.Create,
				target: reference.target,
				properties: { natureId: 'goal', markdown: 'Nouvelle incarnation' },
			},
		]);
		expect(() => {
			assertLiveTextTarget(server, reference);
		}).toThrow(TextTargetGoneError);
		expect(node(server).get('markdown')).toBeInstanceOf(Y.Text);
		client.destroy();
		server.destroy();
	});

	it('rejects a mixed-field update even when its claimed target is still live', () => {
		const { server, client } = replicas();
		const claimed = node(client).get('markdown');
		const other = client
			.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
			.get('source-b')
			?.get('markdown');
		if (!(claimed instanceof Y.Text) || claimed._item === null || !(other instanceof Y.Text))
			throw new Error('Expected two integrated fields');
		const oldId = claimed._item.id;
		claimed.insert(0, 'Claimed ');
		other.insert(0, 'Hidden ');
		const candidate = new Y.Doc({ gc: false });
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
		expect(() => {
			applyTextUpdate(candidate, Y.encodeStateAsUpdate(client), {
				target: { kind: Kind.Node, id: 'source-a' },
				field: 'markdown',
				textId: { client: oldId.client, clock: oldId.clock },
			});
		}).toThrow();
		const accepted = server
			.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
			.get('source-b')
			?.get('markdown');
		if (!(accepted instanceof Y.Text)) throw new Error('Expected authoritative sibling');
		expect(accepted.toJSON()).not.toContain('Hidden ');
		candidate.destroy();
		client.destroy();
		server.destroy();
	});

	it('rejects untyped late text with a surviving sibling edit instead of committing a partial batch', () => {
		const { server, client } = replicas();
		const old = node(client).get('markdown');
		const survivor = client
			.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
			.get('source-b')
			?.get('markdown');
		if (!(old instanceof Y.Text) || !(survivor instanceof Y.Text))
			throw new Error('Expected two text fields');
		old.insert(0, 'Late ');
		survivor.insert(0, 'Unsent ');
		server.getMap(YjsCollection.Nodes).delete('source-a');
		compactRoomDocument(server);
		const candidate = new Y.Doc({ gc: false });
		Y.applyUpdate(candidate, Y.encodeStateAsUpdate(server));
		expect(() => {
			applyTextUpdate(candidate, Y.encodeStateAsUpdate(client));
		}).toThrow();
		const accepted = server
			.getMap<Y.Map<unknown>>(YjsCollection.Nodes)
			.get('source-b')
			?.get('markdown');
		if (!(accepted instanceof Y.Text)) throw new Error('Expected sibling');
		expect(accepted.toJSON()).not.toContain('Unsent ');
		candidate.destroy();
		client.destroy();
		server.destroy();
	});

	it('rejects stale edits to a deleted non-node text field', () => {
		const { server, client } = replicas();
		const group = new Y.Map<unknown>();
		group.set('label', new Y.Text('Group'));
		server.getMap<Y.Map<unknown>>(YjsCollection.Groups).set('G', group);
		Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
		const label = client.getMap<Y.Map<unknown>>(YjsCollection.Groups).get('G')?.get('label');
		if (!(label instanceof Y.Text)) throw new Error('Expected group text');
		label.insert(0, 'Late ');
		server.getMap(YjsCollection.Groups).delete('G');
		expect(() => {
			applyTextUpdate(server, Y.encodeStateAsUpdate(client));
		}).toThrow();
		expect(server.getMap(YjsCollection.Groups).has('G')).toBe(false);
		client.destroy();
		server.destroy();
	});
});

it('rejects a text delta whose preceding local edits are missing', () => {
	const { server, client } = replicas();
	const text = node(client).get('markdown');
	if (!(text instanceof Y.Text)) throw new Error('Expected text');
	text.insert(0, 'First ');
	const vector = Y.encodeStateVector(client);
	text.insert(0, 'Second ');
	const partial = Y.encodeStateAsUpdate(client, vector);
	expect(() => {
		applyTextUpdate(server, partial);
	}).toThrow('unresolved dependencies');
	client.destroy();
	server.destroy();
});

it('rejects a deletion for an insertion the room has never received', () => {
	const { server, client } = replicas();
	const text = node(client).get('markdown');
	if (!(text instanceof Y.Text)) throw new Error('Expected text');
	text.insert(0, 'Pending');
	const vector = Y.encodeStateVector(client);
	text.delete(0, 7);
	expect(() => {
		applyTextUpdate(server, Y.encodeStateAsUpdate(client, vector));
	}).toThrow('unresolved dependencies');
	client.destroy();
	server.destroy();
});

it('does not authorize edits to an undeclared text field', () => {
	const { server, client } = replicas();
	node(server).set('privateText', new Y.Text('Unsupported'));
	Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
	const text = node(client).get('privateText');
	if (!(text instanceof Y.Text)) throw new Error('Expected test text');
	text.insert(0, 'Edited ');
	expect(() => {
		applyTextUpdate(server, Y.encodeStateAsUpdate(client));
	}).toThrow('undeclared field');
	client.destroy();
	server.destroy();
});
