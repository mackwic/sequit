import { expect, it } from 'vitest';
import * as Y from 'yjs';

import { GroupState, JunctionOperator } from '../../../../src/lib/core/document/logic-document';
import { readSharedCommand } from '../../../../src/lib/infrastructure/collaboration/shared-command-codec';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { updateSharedElement } from '../../../../src/lib/infrastructure/collaboration/shared-element';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { SharedElementKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('executes decoded creation and property gestures across all entity kinds', () => {
	const doc = new Y.Doc();
	importLogicDocument(doc, collaborativeFixture(CollaborativeFixture.OpenGroup, 'room'));
	const created = executeSharedCommands(
		doc,
		[
			{
				op: 'create',
				target: { kind: 'nature', id: 'N2' },
				properties: { label: 'Contexte', color: '#aabbcc', icon: 'phosphor:star' },
			},
			{
				op: 'create',
				target: { kind: 'group', id: 'H' },
				properties: { label: 'Sous-groupe', groupId: 'G', state: 'closed' },
			},
			{
				op: 'create',
				target: { kind: 'node', id: 'C' },
				properties: {
					natureId: 'N2',
					markdown: 'Corps',
					description: '**Détails**',
					groupId: 'H',
					color: '#112233',
					icon: 'phosphor:check',
				},
			},
			{
				op: 'create',
				target: { kind: 'junction', id: 'J' },
				properties: { operator: 'or', groupId: 'G' },
			},
			{ op: 'create', target: { kind: 'relation', id: 'BC' }, properties: { from: 'B', to: 'C' } },
		].map(readSharedCommand),
	);
	expect(created.nodes.find(({ id }) => id === 'C')).toMatchObject({
		markdown: 'Corps',
		description: '**Détails**',
		groupId: 'H',
	});
	expect(created.groups.find(({ id }) => id === 'H')).toMatchObject({ state: GroupState.Closed });
	expect(created.junctions[0]?.operator).toBe(JunctionOperator.Or);
	const changed = executeSharedCommands(
		doc,
		[
			{
				op: 'update',
				target: { kind: 'node', id: 'C' },
				set: { natureId: 'N', groupId: 'G' },
				unset: ['color', 'icon'],
			},
			{
				op: 'update',
				target: { kind: 'nature', id: 'N2' },
				set: { color: '#abcdef' },
				unset: ['icon'],
			},
			{ op: 'update', target: { kind: 'group', id: 'H' }, set: {}, unset: ['groupId', 'state'] },
			{
				op: 'update',
				target: { kind: 'junction', id: 'J' },
				set: { operator: 'xor' },
				unset: ['groupId'],
			},
			{
				op: 'update',
				target: { kind: 'relation', id: 'BC' },
				set: { from: 'B', to: 'J' },
				unset: [],
			},
		].map(readSharedCommand),
	);
	expect(changed.nodes.find(({ id }) => id === 'C')).toMatchObject({
		natureId: 'N',
		groupId: 'G',
		description: '**Détails**',
	});
	expect(changed.nodes.find(({ id }) => id === 'C')).not.toHaveProperty('color');
	expect(changed.natures.find(({ id }) => id === 'N2')).toEqual({
		id: 'N2',
		label: 'Contexte',
		color: '#abcdef',
	});
	expect(changed.groups.find(({ id }) => id === 'H')).not.toHaveProperty('groupId');
	expect(changed.groups.find(({ id }) => id === 'H')).not.toHaveProperty('state');
	expect(changed.junctions[0]).toMatchObject({ id: 'J', operator: JunctionOperator.Xor });
	expect(changed.junctions[0]).not.toHaveProperty('groupId');
	expect(changed.relations.find(({ id }) => id === 'BC')).toEqual({ id: 'BC', from: 'B', to: 'J' });
	const deleted = executeSharedCommands(doc, [
		readSharedCommand({ op: 'delete', target: { kind: 'nature', id: 'N2' } }),
	]);
	expect(deleted.natures.map(({ id }) => id)).toEqual(['N']);
	doc.destroy();
});

it.each([
	{ op: 'create', target: { kind: 'node', id: 'C' }, properties: { markdown: 'Missing nature' } },
	{ op: 'create', target: { kind: 'nature', id: 'N2' }, properties: { label: 'Missing color' } },
	{
		op: 'create',
		target: { kind: 'group', id: 'H' },
		properties: { label: 'Invalid parent', groupId: '' },
	},
	{
		op: 'create',
		target: { kind: 'group', id: 'H' },
		properties: { label: 'Invalid state', state: 'hidden' },
	},
	{ op: 'create', target: { kind: 'junction', id: 'J' }, properties: { operator: 'nand' } },
	{ op: 'delete', target: { kind: 'node', id: 'A' }, replacementId: 'B' },
	{ op: 'update', target: { kind: 'relation', id: 'R' }, set: {}, unset: ['from'] },
	{ op: 'update', target: { kind: 'nature', id: 'N' }, set: {}, unset: ['color'] },
	{ op: 'update', target: { kind: 'group', id: 'G' }, set: {}, unset: ['label'] },
])('refuses incomplete or impossible wire commands before execution: %#', (command) => {
	expect(() => readSharedCommand(command)).toThrow();
});

it('keeps structural mutation helpers from replacing or deleting live shared text', () => {
	const doc = new Y.Doc();
	importLogicDocument(doc, collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room'));
	const before = readLogicDocument(doc);
	const target = { kind: SharedElementKind.Node, id: 'A' };
	expect(() => {
		updateSharedElement(doc, { target, set: { markdown: 'Replacement' }, unset: [] });
	}).toThrow('Yjs update');
	expect(() => {
		updateSharedElement(doc, { target, set: {}, unset: ['description'] });
	}).toThrow('Yjs update');
	expect(readLogicDocument(doc)).toEqual(before);
	doc.destroy();
});
