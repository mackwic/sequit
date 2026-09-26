import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	applyTextUpdate,
	TextTargetGoneError,
} from '../../../../src/lib/infrastructure/collaboration/text-update-validation';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
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

	it('rejects late text for a deleted node without restoring it', () => {
		const { server, client } = replicas();
		const text = node(client).get('markdown');
		if (!(text instanceof Y.Text)) throw new Error('Missing text');
		text.insert(0, 'Late ');
		server.getMap(YjsCollection.Nodes).delete('source-a');
		expect(() => {
			applyTextUpdate(server, Y.encodeStateAsUpdate(client));
		}).toThrow(TextTargetGoneError);
		expect(server.getMap(YjsCollection.Nodes).has('source-a')).toBe(false);
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
	}).toThrow('no longer available');
	client.destroy();
	server.destroy();
});
