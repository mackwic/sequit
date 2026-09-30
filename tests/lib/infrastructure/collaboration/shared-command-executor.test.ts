import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	GroupState,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneOrientation,
	LayoutBias,
	LayoutDirection,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { BusinessCommandRefusal } from '../../../../src/lib/infrastructure/collaboration/session-failure';
import { readSharedCommand } from '../../../../src/lib/infrastructure/collaboration/shared-command-codec';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { YjsCollection } from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import {
	SharedCommandKind as Op,
	SharedElementKind as Kind,
	SharedProperty,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

function given(fixture: CollaborativeFixture): Y.Doc {
	const doc = new Y.Doc();
	importLogicDocument(doc, collaborativeFixture(fixture, 'room'));
	return doc;
}

function read(doc: Y.Doc) {
	const result = readLogicDocument(doc);
	if (!result.ok) throw new Error('Invalid result');
	return result.value;
}

describe('shared document commands', () => {
	it('Two boxes: creates R while retaining A and its active text', () => {
		const doc = given(CollaborativeFixture.TwoBoxes);
		const node = doc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('A');
		const text = node?.get('markdown');
		executeSharedCommands(doc, [
			{
				op: Op.Create,
				target: { kind: Kind.Relation, id: 'R' },
				properties: { from: 'B', to: 'A' },
			},
		]);
		expect(read(doc).relations).toEqual([{ id: 'R', from: 'B', to: 'A' }]);
		expect(doc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('A')).toBe(node);
		expect(node?.get('markdown')).toBe(text);
		doc.destroy();
	});

	it('Linked boxes: deleting B also removes R', () => {
		const doc = given(CollaborativeFixture.LinkedBoxes);
		executeSharedCommands(doc, [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
		expect(read(doc).nodes.map((node) => node.id)).toEqual(['A']);
		expect(read(doc).relations).toEqual([]);
		doc.destroy();
	});

	it('Linked boxes: rejects a cyclic relation in the candidate', () => {
		const doc = given(CollaborativeFixture.LinkedBoxes);
		expect(() => {
			executeSharedCommands(doc, [
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'cycle' },
					properties: { from: 'A', to: 'B' },
				},
			]);
		}).toThrow();
		doc.destroy();
	});

	it('Linked boxes: rejects repeating B → A by creation or by moving an endpoint', () => {
		const doc = given(CollaborativeFixture.LinkedBoxes);
		expect(() => {
			executeSharedCommands(doc, [
				{
					op: Op.Create,
					target: { kind: Kind.Relation, id: 'again' },
					properties: { from: 'B', to: 'A' },
				},
			]);
		}).toThrow('already exists');
		executeSharedCommands(doc, [
			{
				op: Op.Create,
				target: { kind: Kind.Junction, id: 'J' },
				properties: { operator: JunctionOperator.Xor },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Relation, id: 'BJ' },
				properties: { from: 'B', to: 'J' },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Relation, id: 'JA' },
				properties: { from: 'J', to: 'A' },
			},
		]);
		expect(() => {
			executeSharedCommands(doc, [
				{ op: Op.Update, target: { kind: Kind.Relation, id: 'JA' }, set: { from: 'B' }, unset: [] },
			]);
		}).toThrow('already exists');
		doc.destroy();
	});

	it('Linked boxes: groups A and B atomically, preserving R', () => {
		const doc = given(CollaborativeFixture.LinkedBoxes);
		executeSharedCommands(doc, [{ op: Op.Group, id: 'G', label: 'Groupe', members: ['A', 'B'] }]);
		expect(read(doc).nodes.every((node) => node.groupId === 'G')).toBe(true);
		expect(read(doc).groups[0]).toMatchObject({ id: 'G', state: GroupState.Expanded });
		expect(read(doc).relations).toHaveLength(1);
		doc.destroy();
	});

	it('Open group: closes G without removing its contents, then dissolves it', () => {
		const doc = given(CollaborativeFixture.OpenGroup);
		executeSharedCommands(doc, [
			{
				op: Op.Update,
				target: { kind: Kind.Group, id: 'G' },
				set: { state: GroupState.Closed },
				unset: [],
			},
		]);
		expect(read(doc).groups[0]?.state).toBe(GroupState.Closed);
		expect(read(doc).nodes).toHaveLength(2);
		executeSharedCommands(doc, [{ op: Op.Ungroup, id: 'G' }]);
		expect(read(doc).groups).toEqual([]);
		expect(read(doc).nodes.every((node) => node.groupId === undefined)).toBe(true);
		expect(read(doc).relations).toHaveLength(1);
		doc.destroy();
	});

	it('Open group: moves a member to the root and back, refusing a group inside itself', () => {
		const doc = given(CollaborativeFixture.OpenGroup);
		executeSharedCommands(doc, [{ op: Op.Move, ids: ['A'] }]);
		expect(read(doc).nodes.find(({ id }) => id === 'A')).not.toHaveProperty('groupId');
		expect(read(doc).nodes.find(({ id }) => id === 'B')).toMatchObject({ groupId: 'G' });
		executeSharedCommands(doc, [{ op: Op.Move, ids: ['A'], groupId: 'G' }]);
		expect(read(doc).nodes.every((node) => node.groupId === 'G')).toBe(true);
		expect(() => executeSharedCommands(doc, [{ op: Op.Move, ids: ['G'], groupId: 'G' }])).toThrow(
			'lui-même',
		);
		expect(() =>
			executeSharedCommands(doc, [{ op: Op.Move, ids: ['A'], groupId: 'nope' }]),
		).toThrow('Groupe introuvable');
		doc.destroy();
	});

	it('Linked boxes: updates direction and bias together', () => {
		const doc = given(CollaborativeFixture.LinkedBoxes);
		const layout = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left } as const;
		executeSharedCommands(doc, [{ op: Op.UpdateLayout, layout }]);
		expect(read(doc).layout).toEqual(layout);
		doc.destroy();
	});

	describe('root lanes', () => {
		const lanes = {
			laneOrientation: LaneOrientation.Parallel,
			lanes: [
				{ id: 'S', label: 'Sales', layoutOrder: 'a0' },
				{ id: 'C', label: 'Customer', layoutOrder: 'a1' },
			],
		};

		it('Open group: activates lanes, keeps members inheriting, then removes a lane with a transfer', () => {
			const doc = given(CollaborativeFixture.OpenGroup);
			executeSharedCommands(doc, [{ op: Op.UpdateLanes, lanes }]);
			let current = read(doc);
			expect(current.persistenceFormat).toBe(LANE_PERSISTENCE_FORMAT);
			expect(current.presentation?.lanes.map(({ id }) => id).sort()).toEqual(['C', 'S']);
			expect(current.groups.map(({ laneId }) => laneId)).toEqual(['S']);
			expect(current.nodes.every(({ laneId }) => laneId === undefined)).toBe(true);
			executeSharedCommands(doc, [
				{ op: Op.Update, target: { kind: Kind.Group, id: 'G' }, set: { laneId: 'C' }, unset: [] },
				{
					op: Op.UpdateLanes,
					lanes: {
						laneOrientation: LaneOrientation.Transverse,
						lanes: [
							{ id: 'S', label: 'Sales', layoutOrder: 'a0' },
							{ id: 'D', label: 'Delivery', layoutOrder: 'a1' },
						],
					},
					transfers: { C: 'D' },
				},
			]);
			current = read(doc);
			expect(current.presentation?.laneOrientation).toBe(LaneOrientation.Transverse);
			expect(current.groups.map(({ laneId }) => laneId)).toEqual(['D']);
			executeSharedCommands(doc, [{ op: Op.UpdateLanes }]);
			current = read(doc);
			expect(current.persistenceFormat).toBe(PERSISTENCE_FORMAT);
			expect(current.presentation).toBeUndefined();
			expect(current.groups.every(({ laneId }) => laneId === undefined)).toBe(true);
			doc.destroy();
		});

		it('Linked boxes: an orphaned element joins the first lane by order, and fewer than two lanes is refused', () => {
			const doc = given(CollaborativeFixture.LinkedBoxes);
			executeSharedCommands(doc, [
				{
					op: Op.UpdateLanes,
					lanes: {
						laneOrientation: LaneOrientation.Parallel,
						lanes: [
							{ id: 'late', label: 'Late', layoutOrder: 'a1' },
							{ id: 'early', label: 'Early', layoutOrder: 'a0' },
						],
					},
				},
			]);
			expect(read(doc).nodes.map(({ laneId }) => laneId)).toEqual(['early', 'early']);
			expect(() =>
				executeSharedCommands(doc, [
					{
						op: Op.UpdateLanes,
						lanes: { ...lanes, lanes: lanes.lanes.slice(0, 1) },
					},
				]),
			).toThrow(BusinessCommandRefusal);
			expect(() =>
				executeSharedCommands(doc, [{ op: Op.UpdateLanes, lanes, transfers: { late: 'nowhere' } }]),
			).toThrow('Lane de destination inconnue');
			doc.destroy();
		});
	});
});

describe('whole-document edits', () => {
	it('creates a nature and grouped node, then updates and removes style fields independently', () => {
		const doc = given(CollaborativeFixture.OpenGroup);
		executeSharedCommands(doc, [
			{
				op: Op.Create,
				target: { kind: Kind.Nature, id: 'N2' },
				properties: { label: 'Décision', color: '#aabbcc' },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Node, id: 'C' },
				properties: { natureId: 'N2', markdown: 'Charlie', groupId: 'G', color: '#112233' },
			},
		]);
		const text = doc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('C')?.get('markdown');
		executeSharedCommands(doc, [
			{
				op: Op.Update,
				target: { kind: Kind.Node, id: 'C' },
				set: { icon: 'phosphor:star' },
				unset: [SharedProperty.Color],
			},
		]);
		expect(read(doc).nodes.find((node) => node.id === 'C')).toMatchObject({
			markdown: 'Charlie',
			groupId: 'G',
			natureId: 'N2',
			icon: 'phosphor:star',
		});
		expect(read(doc).nodes.find((node) => node.id === 'C')).not.toHaveProperty('color');
		expect(doc.getMap<Y.Map<unknown>>(YjsCollection.Nodes).get('C')?.get('markdown')).toBe(text);
		executeSharedCommands(doc, [
			{ op: Op.Delete, target: { kind: Kind.Nature, id: 'N2' }, replacementId: 'N' },
		]);
		expect(read(doc).nodes.find((node) => node.id === 'C')?.natureId).toBe('N');
		expect(read(doc).natures.map((nature) => nature.id)).toEqual(['N']);
		doc.destroy();
	});

	it.each([undefined, 'N', 'missing'])(
		'rejects removal of a used nature with replacement %s',
		(replacementId) => {
			const doc = given(CollaborativeFixture.TwoBoxes);
			const target = { kind: Kind.Nature, id: 'N' } as const;
			expect(() => {
				if (replacementId === undefined) executeSharedCommands(doc, [{ op: Op.Delete, target }]);
				else executeSharedCommands(doc, [{ op: Op.Delete, target, replacementId }]);
			}).toThrow();
			doc.destroy();
		},
	);

	it('deletes an unused nature and a junction with its references', () => {
		const doc = given(CollaborativeFixture.TwoBoxes);
		executeSharedCommands(doc, [
			{
				op: Op.Create,
				target: { kind: Kind.Nature, id: 'unused' },
				properties: { label: 'Unused', color: '#123456' },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Junction, id: 'J' },
				properties: { operator: JunctionOperator.Xor },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Relation, id: 'R1' },
				properties: { from: 'B', to: 'J' },
			},
			{
				op: Op.Create,
				target: { kind: Kind.Relation, id: 'R2' },
				properties: { from: 'J', to: 'A' },
			},
		]);
		executeSharedCommands(doc, [
			{ op: Op.Delete, target: { kind: Kind.Nature, id: 'unused' } },
			{ op: Op.Delete, target: { kind: Kind.Junction, id: 'J' } },
		]);
		expect(read(doc).junctions).toEqual([]);
		expect(read(doc).relations).toEqual([]);
		doc.destroy();
	});

	it('groups inside the existing parent and refuses missing or mixed-parent selections', () => {
		const doc = given(CollaborativeFixture.OpenGroup);
		executeSharedCommands(doc, [{ op: Op.Group, id: 'H', label: 'Sous-groupe', members: ['A'] }]);
		expect(read(doc).groups.find((group) => group.id === 'H')?.groupId).toBe('G');
		for (const members of [[], ['missing'], ['A', 'B']]) {
			expect(() => {
				executeSharedCommands(doc, [{ op: Op.Group, id: 'invalid', label: 'Invalid', members }]);
			}).toThrow();
		}
		doc.destroy();
	});

	it('rejects malformed commands before changing the document', () => {
		const doc = given(CollaborativeFixture.OpenGroup);
		const before = read(doc);
		const target = { kind: Kind.Node, id: 'A' };
		const commands: readonly unknown[] = [
			{ op: Op.Update, target, set: { markdown: 'Replaced' }, unset: [] },
			{ op: Op.Update, target, set: { id: 'renamed' }, unset: [] },
			{ op: Op.Update, target, set: {}, unset: ['natureId'] },
			{ op: Op.Create, target, properties: { natureId: 'N', markdown: 'Duplicate' } },
			{ op: Op.Delete, target: { kind: Kind.Group, id: 'G' } },
			{ op: Op.Create, target: { kind: Kind.Document, id: 'room' }, properties: {} },
			{ op: Op.Delete, target: { kind: Kind.Document, id: 'room' } },
			{ op: Op.Update, target: { kind: Kind.Document, id: 'other' }, set: {}, unset: [] },
			{
				op: Op.Update,
				target: { kind: Kind.Node, id: 'missing' },
				set: { color: '#aabbcc' },
				unset: [],
			},
		];
		for (const command of commands) {
			expect(() => executeSharedCommands(doc, [readSharedCommand(command)])).toThrow();
			expect(read(doc)).toEqual(before);
		}
		doc.destroy();
	});
});

it('allows temporary missing references within one atomic creation batch', () => {
	const doc = given(CollaborativeFixture.TwoBoxes);
	executeSharedCommands(doc, [
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'BC' },
			properties: { from: 'B', to: 'C' },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Node, id: 'C' },
			properties: { natureId: 'N', markdown: 'Charlie' },
		},
	]);
	expect(read(doc).nodes).toHaveLength(3);
	expect(read(doc).relations).toHaveLength(1);
	doc.destroy();
});

it('keeps endpoint references when a nature or relation happens to have the same ID', () => {
	const doc = given(CollaborativeFixture.TwoBoxes);
	executeSharedCommands(doc, [
		{
			op: Op.Create,
			target: { kind: Kind.Nature, id: 'A' },
			properties: { label: 'Unused', color: '#112233' },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Node, id: 'C' },
			properties: { natureId: 'N', markdown: 'Charlie' },
		},
		{ op: Op.Create, target: { kind: Kind.Relation, id: 'A' }, properties: { from: 'B', to: 'A' } },
		{ op: Op.Create, target: { kind: Kind.Relation, id: 'R' }, properties: { from: 'C', to: 'A' } },
	]);
	executeSharedCommands(doc, [{ op: Op.Delete, target: { kind: Kind.Nature, id: 'A' } }]);
	expect(read(doc).relations).toHaveLength(2);
	executeSharedCommands(doc, [{ op: Op.Delete, target: { kind: Kind.Relation, id: 'A' } }]);
	expect(read(doc).relations).toEqual([{ id: 'R', from: 'C', to: 'A' }]);
	expect(read(doc).nodes.map((node) => node.id)).toEqual(['A', 'B', 'C']);
	doc.destroy();
});

it('deleting an isolated node leaves an unrelated relation intact', () => {
	const doc = given(CollaborativeFixture.LinkedBoxes);
	executeSharedCommands(doc, [
		{
			op: Op.Create,
			target: { kind: Kind.Node, id: 'C' },
			properties: { natureId: 'N', markdown: 'Charlie' },
		},
	]);
	executeSharedCommands(doc, [{ op: Op.Delete, target: { kind: Kind.Node, id: 'C' } }]);
	expect(read(doc).relations).toEqual([{ id: 'R', from: 'B', to: 'A' }]);
	doc.destroy();
});
