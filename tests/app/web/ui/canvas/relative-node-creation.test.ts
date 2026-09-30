import { describe, expect, it } from 'vitest';

import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import { planNodeCreation } from '../../../../../src/app/web/ui/canvas/relative-node-creation';
import {
	EndpointKind,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../../support/builders/logic-document';

function ids(lastNatureId?: string) {
	let relation = 0;
	return { nodeId: 'new', relationId: () => `new-relation-${relation++}`, lastNatureId };
}

describe('node creation planning', () => {
	it('creates roots using the last available nature or the first fallback and requested group', () => {
		const document = validLogicDocument();
		const lastNatureId = document.natures.at(-1)?.id;
		if (lastNatureId === undefined) throw new Error('Expected document natures');

		expect(planNodeCreation(document, { groupId: 'container' }, ids(lastNatureId))).toEqual({
			node: {
				id: 'new',
				natureId: lastNatureId,
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

	it('gives a top-level box the double-clicked lane, else the target’s, else the first lane', () => {
		const document = explicitLaneLogicDocument();
		const isolated = document.nodes.find(({ id }) => id === 'isolated');
		if (isolated?.laneId !== 'right') throw new Error('Expected the isolated node in "right"');
		const lane = (request: Parameters<typeof planNodeCreation>[1]) =>
			planNodeCreation(document, request, ids())?.node.laneId;
		expect(lane({ laneId: 'right' })).toBe('right');
		expect(lane({ laneId: 'unknown' })).toBe('left');
		expect(lane({})).toBe('left');
		expect(lane({ target: { kind: EntityKind.Node, id: 'isolated' } })).toBe('right');
		expect(lane({ groupId: 'orphan-group', laneId: 'right' })).toBeUndefined();
		expect(planNodeCreation(validLogicDocument(), { laneId: 'right' }, ids())?.node.laneId).toBe(
			undefined,
		);
	});

	it('creates a child of a node with inherited nature, containment, and one relation', () => {
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
				{ id: 'inherited', label: 'Inherited', color: '#222222' },
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'selected',
					natureId: 'inherited',
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
				ids('first'),
			),
		).toEqual({
			node: { id: 'new', natureId: 'inherited', markdown: '', groupId: 'container' },
			relations: [{ id: 'new-relation-0', from: 'new', to: 'selected' }],
		});
	});

	it('creates a sibling with each parent of the target and none for a root target', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			nodes: [
				...base.nodes,
				{
					kind: EndpointKind.Node,
					id: 'selected',
					natureId: base.natures[0]?.id ?? '',
					markdown: 'Selected',
					layoutOrder: orderKey('a2'),
				},
			],
			relations: [
				{ id: 'first-parent', from: 'selected', to: 'target' },
				{ id: 'second-parent', from: 'selected', to: 'endpoint-group' },
			],
		};

		expect(
			planNodeCreation(
				document,
				{
					target: { kind: EntityKind.Node, id: 'selected' },
					sibling: true,
				},
				ids('missing'),
			),
		).toMatchObject({
			node: { natureId: base.natures[0]?.id },
			relations: [
				{ id: 'new-relation-0', from: 'new', to: 'target' },
				{ id: 'new-relation-1', from: 'new', to: 'endpoint-group' },
			],
		});

		expect(
			planNodeCreation(
				base,
				{
					target: { kind: EntityKind.Node, id: 'isolated' },
					sibling: true,
				},
				ids(),
			),
		).toMatchObject({ relations: [] });
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
	});

	it('rejects missing targets and documents without a nature', () => {
		const document = validLogicDocument();
		expect(
			planNodeCreation(document, { target: { kind: EntityKind.Node, id: 'missing' } }, ids()),
		).toBeUndefined();
		expect(planNodeCreation({ ...document, natures: [] }, {}, ids())).toBeUndefined();
	});
});
