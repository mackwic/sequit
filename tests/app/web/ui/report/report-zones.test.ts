import { describe, expect, it } from 'vitest';

import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import type { CanvasModel } from '../../../../../src/app/web/ui/canvas/canvas-model';
import {
	entitiesInZone,
	entityAt,
	zoneBetween,
} from '../../../../../src/app/web/ui/report/report-zones';
import { JunctionOperator } from '../../../../../src/lib/core/document/logic-document';

const NATURE = { id: 'need', label: 'Need', color: '#000000' };

/** A group holding a node, a junction below it and an L-shaped route around the group. */
const CANVAS: CanvasModel = {
	width: 400,
	height: 300,
	groups: [{ id: 'group', label: 'Group', bounds: { x: 0, y: 0, width: 200, height: 200 } }],
	nodes: [
		{ id: 'node', nature: NATURE, markdown: '', bounds: { x: 20, y: 40, width: 100, height: 60 } },
	],
	junctions: [
		{
			id: 'junction',
			operator: JunctionOperator.And,
			bounds: { x: 60, y: 140, width: 28, height: 20 },
		},
	],
	relations: [
		{
			id: 'route',
			from: 'node',
			to: 'other',
			points: [
				{ x: 300, y: 20 },
				{ x: 300, y: 250 },
				{ x: 100, y: 250 },
			],
		},
	],
};

describe('report zones', () => {
	it('spans the same rectangle whichever corner the drag started from', () => {
		expect(zoneBetween({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
			x: 10,
			y: 20,
			width: 40,
			height: 60,
		});
	});

	it('lists what a drawn zone touches, routes by their pieces rather than their extent', () => {
		expect(entitiesInZone(CANVAS, { x: 100, y: 90, width: 20, height: 60 })).toEqual([
			{ kind: EntityKind.Node, id: 'node' },
			{ kind: EntityKind.Group, id: 'group' },
		]);
		// Inside the route's extent but away from its two pieces.
		expect(entitiesInZone(CANVAS, { x: 220, y: 60, width: 40, height: 40 })).toEqual([]);
		expect(entitiesInZone(CANVAS, { x: 290, y: 100, width: 20, height: 20 })).toEqual([
			{ kind: EntityKind.Relation, id: 'route' },
		]);
	});

	it('points at a box before its group, a nearby route, then the group itself', () => {
		expect(entityAt(CANVAS, { x: 70, y: 150 }, 6)?.ref).toEqual({
			kind: EntityKind.Junction,
			id: 'junction',
		});
		expect(entityAt(CANVAS, { x: 50, y: 50 }, 6)?.ref).toEqual({
			kind: EntityKind.Node,
			id: 'node',
		});
		expect(entityAt(CANVAS, { x: 304, y: 120 }, 6)).toEqual({
			ref: { kind: EntityKind.Relation, id: 'route' },
			bounds: { x: 100, y: 20, width: 200, height: 230 },
		});
		expect(entityAt(CANVAS, { x: 150, y: 20 }, 6)?.ref).toEqual({
			kind: EntityKind.Group,
			id: 'group',
		});
		expect(entityAt(CANVAS, { x: 380, y: 20 }, 6)).toBeUndefined();
	});
});
