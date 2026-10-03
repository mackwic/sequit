import { describe, expect, it } from 'vitest';

import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import { planNodeCreation } from '../../../../../src/app/web/ui/canvas/relative-node-creation';
import {
	EndpointKind,
	GroupState,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../../support/builders/logic-document';

function ids(natureId?: string) {
	let relation = 0;
	return { nodeId: 'new', relationId: () => `new-relation-${relation++}`, natureId };
}

describe('node creation planning', () => {
	it('creates roots with the chosen nature, else the first one, in the requested group', () => {
		const document = validLogicDocument();
		const chosen = document.natures.at(-1)?.id;
		if (chosen === undefined) throw new Error('Expected document natures');

		expect(planNodeCreation(document, { groupId: 'container' }, ids(chosen))).toEqual({
			node: {
				id: 'new',
				natureId: chosen,
				markdown: '',
				groupId: 'container',
			},
			relations: [],
		});
		expect(planNodeCreation(document, {}, ids('missing'))).toEqual({
			node: { id: 'new', natureId: document.natures[0]?.id, markdown: '' },
			relations: [],
		});
	});

	it('gives a top-level box the double-clicked lane, else the target’s or nearby selection’s, else the first lane', () => {
		const document = explicitLaneLogicDocument();
		const isolated = document.nodes.find(({ id }) => id === 'isolated');
		if (isolated?.laneId !== 'right') throw new Error('Expected the isolated node in "right"');
		const lane = (request: Parameters<typeof planNodeCreation>[1]) =>
			planNodeCreation(document, request, ids())?.node.laneId;
		expect(lane({ laneId: 'right' })).toBe('right');
		expect(lane({ laneId: 'unknown' })).toBe('left');
		expect(lane({})).toBe('left');
		expect(lane({ target: { kind: EntityKind.Node, id: 'isolated' } })).toBe('right');
		expect(lane({ near: { kind: EntityKind.Node, id: 'isolated' } })).toBe('right');
		expect(lane({ near: { kind: EntityKind.Node, id: 'missing' } })).toBe('left');
		expect(lane({ groupId: 'orphan-group', laneId: 'right' })).toBeUndefined();
		expect(planNodeCreation(validLogicDocument(), { laneId: 'right' }, ids())?.node.laneId).toBe(
			undefined,
		);
	});

	it('creates a root beside the selection without relation or nature from it', () => {
		const base = explicitLaneLogicDocument();
		const need = { id: 'need', label: 'Need', color: '#aa0044' };
		const document = { ...base, natures: [...base.natures, need] };
		const near = { kind: EntityKind.Node, id: 'isolated' } as const;
		expect(planNodeCreation(document, { near }, ids('need'))).toEqual({
			node: { id: 'new', natureId: 'need', markdown: '', laneId: 'right' },
			relations: [],
		});
	});

	it('creates a child of a node with the chosen nature, its container, and one relation', () => {
		const document: LogicDocument = {
			...validLogicDocument(),
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'container',
					label: 'Container',
					layoutOrder: orderKey('a0'),
				},
			],
			natures: [
				{ id: 'first', label: 'First', color: '#111111' },
				{ id: 'parent', label: 'Parent', color: '#222222' },
				{ id: 'chosen', label: 'Chosen', color: '#333333' },
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'selected',
					natureId: 'parent',
					groupId: 'container',
					markdown: 'Selected',
					layoutOrder: orderKey('a1'),
				},
			],
			junctions: [],
			relations: [],
		};

		expect(
			planNodeCreation(
				document,
				{ target: { kind: EntityKind.Node, id: 'selected' } },
				ids('chosen'),
			),
		).toEqual({
			node: { id: 'new', natureId: 'chosen', markdown: '', groupId: 'container' },
			relations: [{ id: 'new-relation-0', from: 'new', to: 'selected' }],
		});
	});

	it('creates a sibling sharing every parent and the group of the box, a root without them', () => {
		const node = (id: string, layoutOrder: string) => ({
			kind: EndpointKind.Node as const,
			id,
			natureId: 'first',
			markdown: id,
			layoutOrder: orderKey(layoutOrder),
		});
		const document: LogicDocument = {
			...validLogicDocument(),
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'container',
					label: 'Container',
					layoutOrder: orderKey('a0'),
				},
			],
			natures: [{ id: 'first', label: 'First', color: '#111111' }],
			nodes: [
				node('goal', 'a1'),
				node('other-goal', 'a2'),
				{ ...node('selected', 'a3'), groupId: 'container' },
				{ ...node('child', 'a4'), groupId: 'container' },
			],
			junctions: [],
			relations: [
				{ id: 'to-goal', from: 'selected', to: 'goal' },
				{ id: 'to-other-goal', from: 'selected', to: 'other-goal' },
				{ id: 'from-child', from: 'child', to: 'selected' },
			],
		};
		const sibling = { kind: EntityKind.Node, id: 'selected' } as const;

		expect(planNodeCreation(document, { sibling }, ids())).toEqual({
			node: { id: 'new', natureId: 'first', markdown: '', groupId: 'container' },
			relations: [
				{ id: 'new-relation-0', from: 'new', to: 'goal' },
				{ id: 'new-relation-1', from: 'new', to: 'other-goal' },
			],
		});
		expect(
			planNodeCreation(document, { sibling: { kind: EntityKind.Node, id: 'goal' } }, ids()),
		).toEqual({ node: { id: 'new', natureId: 'first', markdown: '' }, relations: [] });
		expect(
			planNodeCreation(document, { sibling: { kind: EntityKind.Node, id: 'gone' } }, ids()),
		).toBeUndefined();
	});

	it('gives a top-level sibling the lane of its box', () => {
		const document = explicitLaneLogicDocument();
		expect(
			planNodeCreation(document, { sibling: { kind: EntityKind.Node, id: 'isolated' } }, ids())
				?.node.laneId,
		).toBe('right');
	});

	it('refuses a box in a folded group, or in a group a folded one contains', () => {
		const base = validLogicDocument();
		const document = (state: GroupState): LogicDocument => ({
			...base,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'outer',
					label: 'Outer',
					state,
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group,
					id: 'inner',
					label: 'Inner',
					groupId: 'outer',
					layoutOrder: orderKey('a1'),
				},
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'member',
					natureId: base.natures[0]?.id ?? '',
					groupId: 'inner',
					markdown: 'Member',
					layoutOrder: orderKey('a2'),
				},
			],
			junctions: [],
			relations: [],
		});
		const target = { kind: EntityKind.Node, id: 'member' } as const;

		const folded = document(GroupState.Closed);
		expect(planNodeCreation(folded, { groupId: 'inner' }, ids())).toBeUndefined();
		expect(planNodeCreation(folded, { groupId: 'outer' }, ids())).toBeUndefined();
		expect(planNodeCreation(folded, { target }, ids())).toBeUndefined();
		const unfolded = document(GroupState.Expanded);
		expect(planNodeCreation(unfolded, { groupId: 'inner' }, ids())?.node).toMatchObject({
			groupId: 'inner',
		});
		expect(planNodeCreation(unfolded, { target }, ids())?.relations).toHaveLength(1);
	});

	it('preserves the container when the target is inside a group', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'outer',
					label: 'Outer',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group,
					id: 'inner',
					label: 'Inner',
					groupId: 'outer',
					layoutOrder: orderKey('a1'),
				},
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'selected',
					natureId: base.natures[0]?.id ?? '',
					groupId: 'inner',
					markdown: 'Selected',
					layoutOrder: orderKey('a2'),
				},
			],
			junctions: [],
		};

		expect(
			planNodeCreation(document, { target: { kind: EntityKind.Node, id: 'selected' } }, ids())
				?.node,
		).toMatchObject({ groupId: 'inner' });
		expect(
			planNodeCreation(document, { near: { kind: EntityKind.Node, id: 'selected' } }, ids())?.node,
		).not.toHaveProperty('groupId');
	});

	it('rejects missing targets and documents without a nature', () => {
		const document = validLogicDocument();
		expect(
			planNodeCreation(document, { target: { kind: EntityKind.Node, id: 'missing' } }, ids()),
		).toBeUndefined();
		expect(planNodeCreation({ ...document, natures: [] }, {}, ids())).toBeUndefined();
	});
});
