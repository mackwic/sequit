import { describe, expect, it } from 'vitest';

import {
	canvasEntityBounds,
	canvasEntityInDirection,
	CanvasNavigationDirection,
	canvasNodeTabOrder,
	createCanvasEntityIndex,
	entityKey,
	EntityKind,
	entityRef,
	entityRefFromKey,
} from '../../src/lib/canvas/canvas-entity';
import type { CanvasModel } from '../../src/lib/canvas/canvas-model';
import { JunctionOperator } from '../../src/lib/document/logic-document';

function canvasModel(): CanvasModel {
	return {
		width: 400,
		height: 300,
		nodes: [
			{
				id: 'shared:id',
				nature: { id: 'goal', label: 'Goal', color: '#00aa44' },
				markdown: 'Node',
				bounds: { x: 10, y: 20, width: 100, height: 60 },
			},
		],
		groups: [{ id: 'shared:id', label: 'Group', bounds: { x: 5, y: 10, width: 140, height: 100 } }],
		junctions: [
			{
				id: 'choice',
				operator: JunctionOperator.Xor,
				bounds: { x: 180, y: 80, width: 32, height: 32 },
			},
		],
		relations: [
			{
				id: 'flow',
				from: 'shared:id',
				to: 'choice',
				points: [
					{ x: 110, y: 50 },
					{ x: 160, y: 50 },
					{ x: 160, y: 96 },
					{ x: 180, y: 96 },
				],
			},
			{ id: 'empty-flow', from: 'choice', to: 'shared:id', points: [] },
		],
	};
}

describe('canvas entity identity', () => {
	it('creates and parses canonical kind-qualified keys without losing colons in IDs', () => {
		const key = entityKey(EntityKind.Node, 'shared:id');
		expect(key).toBe('node:shared:id');
		expect(entityRefFromKey(key)).toEqual({ kind: EntityKind.Node, id: 'shared:id' });
		expect(entityRef(EntityKind.Relation, 'flow')).toEqual({
			kind: EntityKind.Relation,
			id: 'flow',
		});
	});

	it('rejects keys outside the canonical canvas entity namespace', () => {
		expect(() => entityRefFromKey('nature:goal')).toThrow('Invalid canvas entity key: nature:goal');
	});

	it('indexes every entity kind independently when semantic IDs overlap', () => {
		const index = createCanvasEntityIndex(canvasModel());

		expect(index).toHaveLength(5);
		expect(index.get(entityKey(EntityKind.Node, 'shared:id'))).toEqual({
			ref: { kind: EntityKind.Node, id: 'shared:id' },
			bounds: { x: 10, y: 20, width: 100, height: 60 },
			navigationPoint: { x: 60, y: 50 },
		});
		expect(index.get(entityKey(EntityKind.Group, 'shared:id'))?.ref.kind).toBe(EntityKind.Group);
		expect(index.get(entityKey(EntityKind.Junction, 'choice'))?.ref.kind).toBe(EntityKind.Junction);
	});

	it('derives relation anchor bounds from every routed point', () => {
		const index = createCanvasEntityIndex(canvasModel());

		expect(canvasEntityBounds(index, entityKey(EntityKind.Relation, 'flow'))).toEqual({
			x: 110,
			y: 50,
			width: 70,
			height: 46,
		});
		expect(index.get(entityKey(EntityKind.Relation, 'flow'))?.navigationPoint).toEqual({
			x: 160,
			y: 58,
		});
		expect(canvasEntityBounds(index, entityKey(EntityKind.Relation, 'empty-flow'))).toBeUndefined();
	});

	it('anchors a zero-length relation at its only accepted route point', () => {
		const canvas: CanvasModel = {
			width: 100,
			height: 100,
			nodes: [],
			groups: [],
			junctions: [],
			relations: [{ id: 'point-flow', from: 'source', to: 'target', points: [{ x: 30, y: 40 }] }],
		};
		const index = createCanvasEntityIndex(canvas);

		expect(index.get(entityKey(EntityKind.Relation, 'point-flow'))?.navigationPoint).toEqual({
			x: 30,
			y: 40,
		});
	});

	it('orders only nodes for Tab and enters a group at its highest rank then fractional ID', () => {
		const nature = { id: 'goal', label: 'Goal', color: '#00aa44' };
		function node(id: string, x: number, rank: number, layoutOrder: string, groupId?: string) {
			const value = {
				id,
				nature,
				markdown: id,
				bounds: { x, y: rank * 50, width: 40, height: 30 },
				navigation: { layoutOrder, rank },
			};
			if (groupId === undefined) return value;
			return { ...value, navigation: { ...value.navigation, groupId } };
		}
		const canvas: CanvasModel = {
			width: 500,
			height: 400,
			nodes: [
				node('outside-high', 10, 4, 'a5'),
				node('group-low', 50, 1, 'a0', 'container'),
				node('group-second', 90, 3, 'a2', 'container'),
				node('group-first', 130, 3, 'a1', 'container'),
				node('outside-low', 170, 0, 'a9'),
			],
			groups: [
				{
					id: 'container',
					label: 'Container',
					bounds: { x: 40, y: 20, width: 150, height: 250 },
					navigation: { layoutOrder: 'a6' },
				},
			],
			junctions: [
				{
					id: 'skipped-junction',
					operator: JunctionOperator.Xor,
					bounds: { x: 220, y: 100, width: 32, height: 32 },
				},
			],
			relations: [
				{
					id: 'skipped-relation',
					from: 'outside-high',
					to: 'outside-low',
					points: [
						{ x: 30, y: 215 },
						{ x: 190, y: 15 },
					],
				},
			],
		};

		expect(canvasNodeTabOrder(canvas)).toEqual([
			entityRef(EntityKind.Node, 'outside-high'),
			entityRef(EntityKind.Node, 'group-first'),
			entityRef(EntityKind.Node, 'group-second'),
			entityRef(EntityKind.Node, 'group-low'),
			entityRef(EntityKind.Node, 'outside-low'),
		]);
	});

	it('falls back to node geometry when navigation metadata is unavailable', () => {
		const base = canvasModel();
		const firstNode = base.nodes[0];
		if (firstNode === undefined) throw new Error('Expected canvas fixture node');
		const canvas: CanvasModel = {
			...base,
			nodes: [
				{ ...firstNode, id: 'lower', bounds: { x: 10, y: 80, width: 40, height: 30 } },
				{ ...firstNode, id: 'right', bounds: { x: 80, y: 10, width: 40, height: 30 } },
				{ ...firstNode, id: 'left-z', bounds: { x: 10, y: 10, width: 40, height: 30 } },
				{ ...firstNode, id: 'left', bounds: { x: 10, y: 10, width: 40, height: 30 } },
			],
			groups: [],
			junctions: [],
			relations: [],
		};

		expect(canvasNodeTabOrder(canvas)).toEqual([
			entityRef(EntityKind.Node, 'left'),
			entityRef(EntityKind.Node, 'left-z'),
			entityRef(EntityKind.Node, 'right'),
			entityRef(EntityKind.Node, 'lower'),
		]);
	});

	it('omits Tab nodes without indexed navigation geometry', () => {
		const canvas = canvasModel();
		const node = canvas.nodes[0];
		if (node === undefined) throw new Error('Expected canvas fixture node');
		const key = entityKey(EntityKind.Node, node.id);

		expect(canvasNodeTabOrder(canvas, new Map())).toEqual([]);
		expect(
			canvasNodeTabOrder(
				canvas,
				new Map([
					[
						key,
						{
							ref: entityRef(EntityKind.Node, node.id),
							bounds: node.bounds,
							navigationPoint: undefined,
						},
					],
				]),
			),
		).toEqual([]);
	});

	it('breaks equal rank and fractional-order Tab ties by canonical node ID', () => {
		const base = canvasModel();
		const firstNode = base.nodes[0];
		if (firstNode === undefined) throw new Error('Expected canvas fixture node');
		const navigation = { layoutOrder: 'a1', rank: 2 };
		const canvas: CanvasModel = {
			...base,
			nodes: [
				{ ...firstNode, id: 'z-node', navigation },
				{ ...firstNode, id: 'a-node', navigation },
			],
			groups: [],
			junctions: [],
			relations: [],
		};

		expect(canvasNodeTabOrder(canvas)).toEqual([
			entityRef(EntityKind.Node, 'a-node'),
			entityRef(EntityKind.Node, 'z-node'),
		]);
	});

	it('keeps nested group nodes contiguous and terminates malformed containment cycles', () => {
		const nature = { id: 'goal', label: 'Goal', color: '#00aa44' };
		const canvas: CanvasModel = {
			width: 300,
			height: 200,
			nodes: [
				{
					id: 'nested',
					nature,
					markdown: 'nested',
					bounds: { x: 10, y: 10, width: 40, height: 30 },
					navigation: { groupId: 'child', layoutOrder: 'a1', rank: 1 },
				},
				{
					id: 'cycle',
					nature,
					markdown: 'cycle',
					bounds: { x: 60, y: 10, width: 40, height: 30 },
					navigation: { groupId: 'cycle-a', layoutOrder: 'a2', rank: 0 },
				},
			],
			groups: [
				{
					id: 'root',
					label: 'Root',
					bounds: { x: 0, y: 0, width: 120, height: 80 },
					navigation: { layoutOrder: 'a3' },
				},
				{
					id: 'child',
					label: 'Child',
					bounds: { x: 5, y: 5, width: 50, height: 50 },
					navigation: { groupId: 'root', layoutOrder: 'a4' },
				},
				{
					id: 'cycle-a',
					label: 'Cycle A',
					bounds: { x: 50, y: 5, width: 50, height: 50 },
					navigation: { groupId: 'cycle-b', layoutOrder: 'a5' },
				},
				{
					id: 'cycle-b',
					label: 'Cycle B',
					bounds: { x: 50, y: 5, width: 50, height: 50 },
					navigation: { groupId: 'cycle-a', layoutOrder: 'a6' },
				},
			],
			junctions: [],
			relations: [],
		};

		expect(canvasNodeTabOrder(canvas)).toEqual([
			entityRef(EntityKind.Node, 'nested'),
			entityRef(EntityKind.Node, 'cycle'),
		]);
	});

	it('navigates to the nearest eligible entity in all four directions', () => {
		const center = entityRef(EntityKind.Node, 'center');
		const up = entityRef(EntityKind.Relation, 'up-arrow');
		const right = entityRef(EntityKind.Junction, 'right-junction');
		const down = entityRef(EntityKind.Node, 'down-node');
		const left = entityRef(EntityKind.Node, 'left-node');
		const skippedGroup = entityRef(EntityKind.Group, 'nearby-group');
		const index = new Map([
			[
				entityKey(center.kind, center.id),
				{ ref: center, bounds: undefined, navigationPoint: { x: 100, y: 100 } },
			],
			[
				entityKey(up.kind, up.id),
				{ ref: up, bounds: undefined, navigationPoint: { x: 100, y: 20 } },
			],
			[
				entityKey(right.kind, right.id),
				{ ref: right, bounds: undefined, navigationPoint: { x: 180, y: 100 } },
			],
			[
				entityKey(down.kind, down.id),
				{ ref: down, bounds: undefined, navigationPoint: { x: 100, y: 180 } },
			],
			[
				entityKey(left.kind, left.id),
				{ ref: left, bounds: undefined, navigationPoint: { x: 20, y: 100 } },
			],
			[
				entityKey(skippedGroup.kind, skippedGroup.id),
				{ ref: skippedGroup, bounds: undefined, navigationPoint: { x: 100, y: 110 } },
			],
		] as const);
		const centerKey = entityKey(center.kind, center.id);

		expect(canvasEntityInDirection(index, centerKey, CanvasNavigationDirection.Up)).toEqual(up);
		expect(canvasEntityInDirection(index, centerKey, CanvasNavigationDirection.Right)).toEqual(
			right,
		);
		expect(canvasEntityInDirection(index, centerKey, CanvasNavigationDirection.Down)).toEqual(down);
		expect(canvasEntityInDirection(index, centerKey, CanvasNavigationDirection.Left)).toEqual(left);
	});

	it('does not wrap at an edge and breaks equal-distance ties by canonical entity identity', () => {
		const origin = entityRef(EntityKind.Node, 'origin');
		const relation = entityRef(EntityKind.Relation, 'a-relation');
		const junction = entityRef(EntityKind.Junction, 'z-junction');
		const index = new Map([
			[
				entityKey(origin.kind, origin.id),
				{ ref: origin, bounds: undefined, navigationPoint: { x: 0, y: 0 } },
			],
			[
				entityKey(junction.kind, junction.id),
				{ ref: junction, bounds: undefined, navigationPoint: { x: 10, y: 10 } },
			],
			[
				entityKey(relation.kind, relation.id),
				{ ref: relation, bounds: undefined, navigationPoint: { x: 10, y: -10 } },
			],
		] as const);
		const originKey = entityKey(origin.kind, origin.id);

		expect(
			canvasEntityInDirection(index, originKey, CanvasNavigationDirection.Left),
		).toBeUndefined();
		expect(canvasEntityInDirection(index, originKey, CanvasNavigationDirection.Up)).toEqual(
			relation,
		);
		expect(canvasEntityInDirection(index, originKey, CanvasNavigationDirection.Right)).toEqual(
			junction,
		);
	});

	it('uses primary distance before identity for equal-distance directional candidates', () => {
		const origin = entityRef(EntityKind.Node, 'origin');
		const nearerAxis = entityRef(EntityKind.Node, 'nearer-axis');
		const fartherAxis = entityRef(EntityKind.Node, 'farther-axis');
		const index = new Map([
			[
				entityKey(origin.kind, origin.id),
				{ ref: origin, bounds: undefined, navigationPoint: { x: 0, y: 0 } },
			],
			[
				entityKey(nearerAxis.kind, nearerAxis.id),
				{ ref: nearerAxis, bounds: undefined, navigationPoint: { x: 3, y: 4 } },
			],
			[
				entityKey(fartherAxis.kind, fartherAxis.id),
				{ ref: fartherAxis, bounds: undefined, navigationPoint: { x: 4, y: 3 } },
			],
		] as const);

		expect(
			canvasEntityInDirection(
				index,
				entityKey(origin.kind, origin.id),
				CanvasNavigationDirection.Right,
			),
		).toEqual(nearerAxis);
	});

	it('returns undefined for missing entities and bounds', () => {
		const index = createCanvasEntityIndex(canvasModel());

		expect(canvasEntityBounds(index, entityKey(EntityKind.Node, 'missing'))).toBeUndefined();
		expect(index.get(entityKey(EntityKind.Relation, 'missing'))).toBeUndefined();
		expect(
			canvasEntityInDirection(
				index,
				entityKey(EntityKind.Node, 'missing'),
				CanvasNavigationDirection.Right,
			),
		).toBeUndefined();
		expect(
			canvasEntityInDirection(
				index,
				entityKey(EntityKind.Node, 'shared:id'),
				CanvasNavigationDirection.Right,
			),
		).toEqual(entityRef(EntityKind.Relation, 'flow'));
	});
});
