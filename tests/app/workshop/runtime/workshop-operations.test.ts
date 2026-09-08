import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import source from '../../../../src/app/workshop/branching.toml?raw';
import { WorkshopDocument } from '../../../../src/app/workshop/runtime/workshop-document';
import {
	changeWorkshopMembership,
	dissolveWorkshopGroup,
	groupWorkshopNodes,
} from '../../../../src/app/workshop/runtime/workshop-group-operations';
import {
	addWorkshopNode,
	duplicateWorkshopNodes,
	placeWorkshopNodeFirst,
	removeWorkshopNodes,
} from '../../../../src/app/workshop/runtime/workshop-node-operations';
import { EndpointKind, JunctionOperator } from '../../../../src/lib/core/document/logic-document';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';

const stores: WorkshopDocument[] = [];
function open() {
	const store = new WorkshopDocument(source);
	stores.push(store);
	return store;
}
afterEach(() => {
	for (const store of stores) store.destroy();
	stores.length = 0;
});

describe('atomic workshop commands', () => {
	it('creates a connected node in one undo step and restores exactly on redo', () => {
		const store = open();
		const original = store.text();
		store.edit((current) =>
			addWorkshopNode(
				current,
				{ id: 'new', natureId: 'action', markdown: 'Suite' },
				{ id: 'link', from: 'comparer' },
			),
		);
		expect(store.node('new').markdown).toBe('Suite');
		expect(store.read().relations).toContainEqual({ id: 'link', from: 'comparer', to: 'new' });
		const changed = store.text();
		store.history.undo();
		expect(store.text()).toBe(original);
		expect(store.history.canUndo()).toBe(false);
		store.history.redo();
		expect(store.text()).toBe(changed);
	});
	it('rolls back the whole action when creation or the connection is invalid', () => {
		const store = open();
		const original = store.text();
		for (const [natureId, from] of [
			['missing', 'comparer'],
			['action', 'missing'],
			['action', 'new'],
		] as const) {
			expect(() => {
				store.edit((current) =>
					addWorkshopNode(current, { id: 'new', natureId, markdown: '' }, { id: 'link', from }),
				);
			}).toThrow();
			expect(store.text()).toBe(original);
			expect(store.history.canUndo()).toBe(false);
		}
	});
	it('duplicates a selection atomically, keeping nature, content and group but no relations', () => {
		const store = open();
		store.edit((current) =>
			groupWorkshopNodes(current, { id: 'g', label: 'Sources' }, new Set(['collecter'])),
		);
		const original = store.text();
		store.edit((current) =>
			duplicateWorkshopNodes(current, [
				{ sourceId: 'collecter', id: 'a' },
				{ sourceId: 'explorer', id: 'b' },
			]),
		);
		expect(store.node('a')).toMatchObject({
			groupId: 'g',
			natureId: 'action',
			markdown: store.node('collecter').markdown,
		});
		expect(store.node('b')).not.toHaveProperty('groupId');
		expect(store.read().relations).toHaveLength(3);
		store.history.undo();
		expect(store.text()).toBe(original);
		expect(() => duplicateWorkshopNodes(store.read(), [{ sourceId: 'missing', id: 'c' }])).toThrow(
			'Boîte introuvable',
		);
	});
	it('removes incoming and outgoing relations with their node in one operation', () => {
		const store = open();
		const original = store.text();
		store.edit((current) => removeWorkshopNodes(current, new Set(['comparer'])));
		expect(store.read().nodes).toHaveLength(3);
		expect(store.read().relations).toHaveLength(0);
		store.history.undo();
		expect(store.text()).toBe(original);
	});
	it('places a peer before the first key, using canonical order, and does not reorder other ranks', () => {
		const store = open();
		store.edit((current) => ({
			...current,
			nodes: current.nodes.map((node) => {
				if (node.id === 'collecter') return { ...node, layoutOrder: 'Zz' };
				if (node.id === 'explorer') return { ...node, layoutOrder: 'a0' };
				return node;
			}),
		}));
		const before = store.read();
		store.edit((current) => placeWorkshopNodeFirst(current, 'explorer'));
		expect(
			fractionalOrderKeySpace.compare(
				store.node('explorer').layoutOrder,
				store.node('collecter').layoutOrder,
			),
		).toBeLessThan(0);
		expect(store.node('comparer')).toEqual(before.nodes.find(({ id }) => id === 'comparer'));
		expect(placeWorkshopNodeFirst(store.read(), 'explorer')).toEqual(store.read());
		expect(placeWorkshopNodeFirst(store.read(), 'comparer')).toEqual(store.read());
		expect(() => placeWorkshopNodeFirst(before, 'missing')).toThrow();
		expect(() =>
			placeWorkshopNodeFirst(
				{
					...before,
					relations: [...before.relations, { id: 'cycle', from: 'comparer', to: 'collecter' }],
				},
				'collecter',
			),
		).toThrow();
	});
	it('preserves arbitrary content through a composed action, undo and redo', () => {
		fc.assert(
			fc.property(fc.string(), (markdown) => {
				const store = new WorkshopDocument(source);
				try {
					const original = store.text();
					store.edit((current) =>
						addWorkshopNode(
							current,
							{ id: 'generated', natureId: 'action', markdown },
							{ id: 'generated-link', from: 'collecter' },
						),
					);
					store.history.undo();
					expect(store.text()).toBe(original);
					store.history.redo();
					expect(store.node('generated').markdown).toBe(markdown);
				} finally {
					store.destroy();
				}
			}),
			{ numRuns: 30 },
		);
	});
});

describe('group transformations', () => {
	it('changes only selected members of the intended group', () => {
		const store = open();
		store.edit((current) =>
			groupWorkshopNodes(current, { id: 'g', label: 'G' }, new Set(['collecter'])),
		);
		store.edit((current) =>
			groupWorkshopNodes(current, { id: 'other', label: 'Autre' }, new Set(['explorer'])),
		);
		store.edit((current) =>
			changeWorkshopMembership(current, 'g', new Set(['collecter', 'explorer']), false),
		);
		expect(store.node('collecter')).not.toHaveProperty('groupId');
		expect(store.node('explorer').groupId).toBe('other');
		store.edit((current) => changeWorkshopMembership(current, 'g', new Set(['explorer']), true));
		expect(store.node('explorer').groupId).toBe('g');
		expect(() => changeWorkshopMembership(store.read(), 'missing', new Set(), true)).toThrow();
	});
	it('dissolves nested groups into their parent, preserving descendants and unrelated links', () => {
		const store = open();
		store.edit((current) =>
			groupWorkshopNodes(current, { id: 'parent', label: 'Parent' }, new Set()),
		);
		store.edit((current) =>
			groupWorkshopNodes(current, { id: 'g', label: 'G' }, new Set(['collecter'])),
		);
		store.edit((current) => ({
			...current,
			groups: [
				...current.groups.map((group) => {
					if (group.id === 'g') return { ...group, groupId: 'parent' };
					return group;
				}),
				{
					id: 'child',
					label: 'Enfant',
					kind: EndpointKind.Group,
					layoutOrder: 'b00',
					groupId: 'g',
				},
			],
			junctions: [
				{
					id: 'j',
					kind: EndpointKind.Junction,
					operator: JunctionOperator.Xor,
					layoutOrder: 'b01',
					groupId: 'g',
				},
			],
			relations: [...current.relations, { id: 'group-link', from: 'g', to: 'decider' }],
		}));
		store.edit((current) => dissolveWorkshopGroup(current, 'g'));
		expect(store.node('collecter').groupId).toBe('parent');
		expect(store.read().groups.find(({ id }) => id === 'child')?.groupId).toBe('parent');
		expect(store.read().junctions[0]?.groupId).toBe('parent');
		expect(store.read().relations).toHaveLength(3);
		store.edit((current) => dissolveWorkshopGroup(current, 'parent'));
		expect(store.node('collecter')).not.toHaveProperty('groupId');
		expect(() => dissolveWorkshopGroup(store.read(), 'missing')).toThrow();
	});
});
