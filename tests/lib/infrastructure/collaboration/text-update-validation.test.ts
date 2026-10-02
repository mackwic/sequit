import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { compactRoomDocument } from '../../../../src/lib/infrastructure/collaboration/compact-room-document';
import { SessionFailureCode } from '../../../../src/lib/infrastructure/collaboration/session-reasons';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	assertKnownTextDeletions,
	assertTextStructParents,
} from '../../../../src/lib/infrastructure/collaboration/text-parent-validation';
import {
	applyTextUpdate,
	assertSyntacticTextProposal,
	isLiveTextTarget,
} from '../../../../src/lib/infrastructure/collaboration/text-update-validation';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { validLogicDocument } from '../../../support/builders/logic-document';

/** Protocol violations reject the document, with the violation as an untranslated detail. */
function invalidDocument(detail: string): unknown {
	return expect.objectContaining({
		reason: { code: SessionFailureCode.InvalidDocument, details: [detail] },
	});
}

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
		expect(() => {
			assertSyntacticTextProposal(reference, update);
		}).not.toThrow();
		expect(() => {
			assertSyntacticTextProposal({ ...reference, field: 'title' }, update);
		}).toThrow();
		expect(() => {
			assertSyntacticTextProposal(
				{ ...reference, target: { kind: Kind.Relation, id: 'relation-a' }, field: 'label' },
				update,
			);
		}).toThrow();
		client.destroy();
		server.destroy();
	});

	it('distinguishes deletion-only text from structural or embedded deleted items', () => {
		const { server, client } = replicas();
		const text = node(client).get('markdown');
		if (!(text instanceof Y.Text) || text._item === null) throw new Error('Missing text');
		const textId = text._item.id;
		const reference = { target: { kind: Kind.Node, id: 'source-a' }, field: 'markdown', textId };
		const state = Y.encodeStateVector(server);
		text.delete(0, 1);
		const update = Y.decodeUpdate(Y.encodeStateAsUpdate(client, state));
		expect(update.structs).toHaveLength(0);
		expect(update.ds.clients.size).toBeGreaterThan(0);
		expect(() => {
			assertSyntacticTextProposal(reference, update);
		}).not.toThrow();
		expect(() => {
			assertKnownTextDeletions(server, reference, update.ds.clients);
		}).not.toThrow();
		const structural = new Y.Doc({ gc: false });
		Y.applyUpdate(structural, Y.encodeStateAsUpdate(server));
		structural.getMap(YjsCollection.Nodes).delete('source-b');
		const deletion = Y.decodeUpdate(Y.encodeStateAsUpdate(structural, Y.encodeStateVector(server)));
		expect(deletion.structs).toHaveLength(0);
		expect(() => {
			assertKnownTextDeletions(server, reference, deletion.ds.clients);
		}).toThrow();
		const embedded = node(server).get('markdown');
		if (!(embedded instanceof Y.Text)) throw new Error('Missing embedded text');
		embedded.insertEmbed(0, { unauthorized: true });
		const withEmbed = new Y.Doc({ gc: false });
		Y.applyUpdate(withEmbed, Y.encodeStateAsUpdate(server));
		const embeddedCandidate = node(withEmbed).get('markdown');
		if (!(embeddedCandidate instanceof Y.Text)) throw new Error('Missing candidate embedded text');
		embeddedCandidate.delete(0, 1);
		const embedDeletion = Y.decodeUpdate(
			Y.encodeStateAsUpdate(withEmbed, Y.encodeStateVector(server)),
		);
		expect(embedDeletion.structs).toHaveLength(0);
		expect(() => {
			assertKnownTextDeletions(server, reference, embedDeletion.ds.clients);
		}).toThrow();
		withEmbed.destroy();
		executeSharedCommands(server, [{ op: Op.Delete, target: { kind: Kind.Node, id: 'source-a' } }]);
		compactRoomDocument(server);
		expect(() => {
			assertKnownTextDeletions(server, reference, update.ds.clients);
		}).not.toThrow();
		const unknown = new Y.Doc({ gc: false });
		const remoteText = unknown.getText('unseen');
		remoteText.insert(0, 'x');
		remoteText.delete(0, 1);
		const unseen = Y.decodeUpdate(Y.encodeStateAsUpdate(unknown)).ds.clients;
		expect(unseen.size).toBeGreaterThan(0);
		expect(() => {
			assertKnownTextDeletions(server, reference, unseen);
		}).toThrow();
		unknown.destroy();
		structural.destroy();
		client.destroy();
		server.destroy();
	});

	it('terminates a deletion-only proposal against another known text field', () => {
		const { server, client } = replicas();
		const target = node(server).get('markdown');
		const other = client.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b');
		const otherText = other?.get('markdown');
		if (!(target instanceof Y.Text) || target._item === null)
			throw new Error('Missing target text');
		if (!(otherText instanceof Y.Text)) throw new Error('Missing foreign text');
		const reference = {
			target: { kind: Kind.Node, id: 'source-a' },
			field: 'markdown',
			textId: target._item.id,
		};
		otherText.delete(0, 1);
		const update = Y.decodeUpdate(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server)));
		expect(update.structs).toHaveLength(0);
		expect(() => {
			assertSyntacticTextProposal(reference, update);
		}).not.toThrow();
		expect(() => {
			assertKnownTextDeletions(server, reference, update.ds.clients);
		}).toThrow();
		client.destroy();
		server.destroy();
	});

	it.each(['string', 'deleted'] as const)(
		'terminates forged %s content under a known Y.Array despite claiming an old text',
		(kind) => {
			const { server, client } = replicas();
			const oldText = node(client).get('markdown');
			if (!(oldText instanceof Y.Text) || oldText._item === null)
				throw new Error('Missing old text');
			const reference = {
				target: { kind: Kind.Node as const, id: 'source-a' },
				field: 'markdown',
				textId: oldText._item.id,
			};
			executeSharedCommands(server, [{ op: Op.Delete, target: reference.target }]);
			const other = server.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b');
			if (other === undefined) throw new Error('Missing survivor');
			const array = new Y.Array();
			other.set('rogue', array);
			if (array._item === null) throw new Error('Missing integrated array');
			let content: Y.ContentString | Y.ContentDeleted = new Y.ContentString('bad');
			if (kind === 'deleted') content = new Y.ContentDeleted(1);
			const item = new Y.Item(
				{ client: 999, clock: 0 },
				null,
				null,
				null,
				null,
				array._item.id,
				null,
				content,
			);
			const decoded = { structs: [item], ds: { clients: new Map() } };
			expect(() => {
				assertSyntacticTextProposal(reference, decoded);
			}).not.toThrow();
			expect(() => {
				assertTextStructParents(server, reference, decoded.structs);
			}).toThrow();
			other.delete('rogue');
			expect(() => {
				assertTextStructParents(server, reference, decoded.structs);
			}).toThrow();
			compactRoomDocument(server);
			expect(() => {
				assertTextStructParents(server, reference, decoded.structs);
			}).not.toThrow();
			client.destroy();
			server.destroy();
		},
	);

	it('checks the exact old text incarnation, field, element, and document when ancestry remains known', () => {
		const { server, client } = replicas();
		const text = node(server).get('markdown');
		const other = server.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b');
		const otherText = other?.get('markdown');
		const title = server.getMap(YjsCollection.Meta).get('title');
		if (!(text instanceof Y.Text) || text._item === null) throw new Error('Missing original text');
		if (!(otherText instanceof Y.Text) || otherText._item === null)
			throw new Error('Missing other text');
		if (!(title instanceof Y.Text) || title._item === null)
			throw new Error('Missing document title');
		const reference = {
			target: { kind: Kind.Node as const, id: 'source-a' },
			field: 'markdown',
			textId: text._item.id,
		};
		const proposed = new Y.Item(
			{ client: 998, clock: 0 },
			null,
			null,
			null,
			null,
			text._item.id,
			null,
			new Y.ContentString('old text'),
		);
		executeSharedCommands(server, [{ op: Op.Delete, target: reference.target }]);
		expect(() => {
			assertTextStructParents(server, reference, [proposed]);
		}).not.toThrow();
		for (const invalid of [
			{ ...reference, textId: otherText._item.id },
			{ ...reference, field: 'description' },
			{ ...reference, target: { kind: Kind.Node, id: 'source-b' } },
			{ ...reference, target: { kind: Kind.Group, id: 'source-a' } },
			{ ...reference, target: { kind: Kind.Document, id: 'source-a' } },
		]) {
			expect(() => {
				assertTextStructParents(server, invalid, [proposed]);
			}).toThrow();
		}
		const documentId = server.getMap(YjsCollection.Meta).get('id');
		if (typeof documentId !== 'string') throw new Error('Missing document ID');
		const documentReference = {
			target: { kind: Kind.Document, id: documentId },
			field: 'title',
			textId: title._item.id,
		};
		const titleProposal = new Y.Item(
			{ client: 998, clock: 1 },
			null,
			null,
			null,
			null,
			title._item.id,
			null,
			new Y.ContentString('title'),
		);
		expect(() => {
			assertTextStructParents(server, documentReference, [titleProposal]);
		}).not.toThrow();
		expect(() => {
			assertTextStructParents(
				server,
				{ ...documentReference, target: { kind: Kind.Document, id: 'wrong-document' } },
				[titleProposal],
			);
		}).toThrow();
		client.destroy();
		server.destroy();
	});

	it('resolves causal origins across proposed items and rejects a second anchor into a known foreign container', () => {
		const { server, client } = replicas();
		const text = node(server).get('markdown');
		const other = server.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b');
		if (
			!(text instanceof Y.Text) ||
			text._item === null ||
			text._start === null ||
			other === undefined
		)
			throw new Error('Missing text characters or other node');
		const array = new Y.Array();
		other.set('rogue', array);
		if (array._item === null) throw new Error('Missing integrated array');
		const reference = {
			target: { kind: Kind.Node, id: 'source-a' },
			field: 'markdown',
			textId: text._item.id,
		};
		const oldCharacterAnchor = new Y.Item(
			{ client: 997, clock: 0 },
			null,
			text._start.id,
			null,
			null,
			null,
			null,
			new Y.ContentString('causal old text'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [oldCharacterAnchor]);
		}).not.toThrow();
		const circularFirstId = { client: 996, clock: 0 };
		const circularSecondId = { client: 996, clock: 1 };
		const circularFirst = new Y.Item(
			circularFirstId,
			null,
			circularSecondId,
			null,
			null,
			null,
			null,
			new Y.ContentString('cycle'),
		);
		const circularSecond = new Y.Item(
			circularSecondId,
			null,
			circularFirstId,
			null,
			null,
			null,
			null,
			new Y.ContentString('cycle'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [circularFirst, circularSecond]);
		}).toThrow();
		const firstId = { client: 998, clock: 0 };
		const first = new Y.Item(
			firstId,
			null,
			null,
			null,
			null,
			text._item.id,
			null,
			new Y.ContentString('a'),
		);
		const next = new Y.Item(
			{ client: 998, clock: 1 },
			null,
			firstId,
			null,
			null,
			null,
			null,
			new Y.ContentString('b'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [first, next]);
		}).not.toThrow();
		const earlierAnchor = new Y.Item(
			{ client: 998, clock: 2 },
			null,
			firstId,
			null,
			null,
			null,
			null,
			new Y.ContentString('still first'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [first, next, earlierAnchor]);
		}).not.toThrow();
		const omittedClock = new Y.Item(
			{ client: 998, clock: 4 },
			null,
			{ client: 998, clock: 3 },
			null,
			null,
			null,
			null,
			new Y.ContentString('missing causal item'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [first, next, omittedClock]);
		}).toThrow();
		const erasedContent = new Y.Item(
			{ client: 996, clock: 0 },
			null,
			null,
			null,
			null,
			text._item.id,
			null,
			new Y.ContentDeleted(1),
		);
		const afterErasure = new Y.Item(
			{ client: 996, clock: 1 },
			null,
			erasedContent.id,
			null,
			null,
			null,
			null,
			new Y.ContentString('follows erased payload'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [erasedContent, afterErasure]);
		}).not.toThrow();
		const nestedUnderDeletion = new Y.Item(
			{ client: 996, clock: 1 },
			null,
			null,
			null,
			null,
			erasedContent.id,
			null,
			new Y.ContentString('deleted content is not a type'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [erasedContent, nestedUnderDeletion]);
		}).toThrow();
		const crossContainer = new Y.Item(
			{ client: 998, clock: 1 },
			null,
			firstId,
			null,
			array._item.id,
			null,
			null,
			new Y.ContentDeleted(1),
		);
		expect(() => {
			assertTextStructParents(server, reference, [first, crossContainer]);
		}).toThrow();
		const deletedAnchor = new Y.Item(
			{ client: 998, clock: 1 },
			null,
			firstId,
			null,
			null,
			null,
			null,
			new Y.ContentDeleted(1),
		);
		expect(() => {
			assertTextStructParents(server, reference, [first, deletedAnchor]);
		}).not.toThrow();
		const missingOrigin = new Y.Item(
			{ client: 999, clock: 1 },
			null,
			null,
			null,
			{ client: 701, clock: 0 },
			null,
			null,
			new Y.ContentString('unresolved origin'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [missingOrigin]);
		}).toThrow();
		server.store.clients.set(701, [new Y.GC({ client: 701, clock: 0 }, 1)]);
		expect(() => {
			assertTextStructParents(server, reference, [missingOrigin]);
		}).not.toThrow();
		const unanchored = new Y.Item(
			{ client: 999, clock: 2 },
			null,
			null,
			null,
			null,
			null,
			null,
			new Y.ContentString('no GC evidence'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [unanchored]);
		}).toThrow();
		const missing = new Y.Item(
			{ client: 999, clock: 0 },
			null,
			null,
			null,
			null,
			{ client: 700, clock: 0 },
			null,
			new Y.ContentString('unknown parent'),
		);
		expect(() => {
			assertTextStructParents(server, reference, [missing]);
		}).toThrow();
		server.store.clients.set(700, [new Y.GC({ client: 700, clock: 0 }, 1)]);
		expect(() => {
			assertTextStructParents(server, reference, [missing]);
		}).not.toThrow();
		client.destroy();
		server.destroy();
	});

	it('terminates text claims attached to rooted metadata, embedded array text or a plain character', () => {
		const { server, client } = replicas();
		const title = server.getMap(YjsCollection.Meta).get('title');
		const target = node(server).get('markdown');
		const other = server.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('source-b');
		if (!(title instanceof Y.Text) || title._item === null)
			throw new Error('Missing document title');
		if (!(target instanceof Y.Text) || target._item === null || target._start === null)
			throw new Error('Missing target text characters');
		if (other === undefined) throw new Error('Missing other node');
		const array = new Y.Array<Y.Text>();
		other.set('embedded', array);
		const nested = new Y.Text('embedded');
		array.push([nested]);
		if (nested._item === null) throw new Error('Missing nested text');
		for (const [parent, field, textId] of [
			[title._item.id, 'title', title._item.id],
			[nested._item.id, 'markdown', nested._item.id],
			[target._start.id, 'markdown', target._item.id],
		] as const) {
			const proposal = new Y.Item(
				{ client: 999, clock: 0 },
				null,
				null,
				null,
				null,
				parent,
				null,
				new Y.ContentString('bad container'),
			);
			expect(() => {
				assertTextStructParents(
					server,
					{ target: { kind: Kind.Node, id: 'source-a' }, field, textId },
					[proposal],
				);
			}).toThrow();
		}
		client.destroy();
		server.destroy();
	});

	it('rejects blank, root, embedded and structural edits before a stale-target refusal', () => {
		const { server, client } = replicas();
		const text = node(client).get('markdown');
		if (!(text instanceof Y.Text) || text._item === null) throw new Error('Missing text');
		const reference = {
			target: { kind: Kind.Node, id: 'source-a' },
			field: 'markdown',
			textId: text._item.id,
		};
		const empty = new Y.Doc();
		expect(() => {
			assertSyntacticTextProposal(reference, Y.decodeUpdate(Y.encodeStateAsUpdate(empty)));
		}).toThrow();
		const root = new Y.Doc();
		root.getText('rogue').insert(0, 'Not a document field');
		expect(() => {
			assertSyntacticTextProposal(reference, Y.decodeUpdate(Y.encodeStateAsUpdate(root)));
		}).toThrow();
		const embed = new Y.Doc({ gc: false });
		Y.applyUpdate(embed, Y.encodeStateAsUpdate(server));
		const embedded = node(embed).get('markdown');
		if (!(embedded instanceof Y.Text)) throw new Error('Missing embedded text');
		embedded.insertEmbed(0, { unauthorized: true });
		expect(() => {
			assertSyntacticTextProposal(
				reference,
				Y.decodeUpdate(Y.encodeStateAsUpdate(embed, Y.encodeStateVector(server))),
			);
		}).toThrow();
		node(client).set('color', '#ff0000');
		expect(() => {
			assertSyntacticTextProposal(
				reference,
				Y.decodeUpdate(Y.encodeStateAsUpdate(client, Y.encodeStateVector(server))),
			);
		}).toThrow();
		expect(() => {
			assertSyntacticTextProposal(reference, {
				structs: [new Y.GC({ client: 10, clock: 0 }, 1)],
				ds: { clients: new Map() },
			});
		}).toThrow();
		const keyedText = new Y.Item(
			{ client: 10, clock: 0 },
			null,
			null,
			null,
			null,
			reference.textId,
			'not-a-text-field',
			new Y.ContentString('bad'),
		);
		expect(() => {
			assertSyntacticTextProposal(reference, {
				structs: [keyedText],
				ds: { clients: new Map() },
			});
		}).toThrow();
		empty.destroy();
		root.destroy();
		embed.destroy();
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
		expect(isLiveTextTarget(server, reference)).toBe(true);
		executeSharedCommands(server, [{ op: Op.Delete, target: reference.target }]);
		compactRoomDocument(server);
		expect(isLiveTextTarget(server, reference)).toBe(false);
		executeSharedCommands(server, [
			{
				op: Op.Create,
				target: reference.target,
				properties: { natureId: 'goal', markdown: 'Nouvelle incarnation' },
			},
		]);
		expect(isLiveTextTarget(server, reference)).toBe(false);
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
	}).toThrow(invalidDocument('Text update has unresolved dependencies.'));
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
	}).toThrow(invalidDocument('Text update has unresolved dependencies.'));
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
	}).toThrow(invalidDocument('Text update targets an undeclared field.'));
	client.destroy();
	server.destroy();
});
