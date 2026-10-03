import { describe, expect, it } from 'vitest';

import {
	GeometryChange,
	geometryDifferences,
	GeometryPart,
} from '../../../../src/app/workshop/layout-reports/layout-differences';
import type { ReportedLayout } from '../../../../src/lib/infrastructure/layout-report/layout-report';

const BOUNDS = { x: 0, y: 0, width: 100, height: 40 };
const ROUTE = {
	id: 'e3',
	from: 'e2',
	to: 'e1',
	points: [
		{ x: 50, y: 100 },
		{ x: 50, y: 40 },
	],
};

const BEFORE: ReportedLayout = {
	width: 400,
	height: 300,
	nodes: [
		{ id: 'e1', bounds: BOUNDS },
		{ id: 'e2', bounds: { ...BOUNDS, y: 100 } },
	],
	groups: [{ id: 'e5', bounds: BOUNDS }],
	junctions: [],
	relations: [ROUTE],
	lanes: [
		{ id: 'e7', regionId: 'e8', bounds: BOUNDS },
		{ id: 'e7', regionId: 'e9', bounds: BOUNDS },
	],
	regions: [],
};

describe('geometry differences', () => {
	it('finds nothing between equal geometries, within a hundredth of a pixel', () => {
		const nudged = {
			...BEFORE,
			nodes: BEFORE.nodes.map((node) => ({
				...node,
				bounds: { ...node.bounds, x: node.bounds.x + 0.001 },
			})),
		};
		expect(geometryDifferences(BEFORE, nudged)).toEqual([]);
	});

	it('names what moved, appeared and disappeared, part by part', () => {
		const after: ReportedLayout = {
			...BEFORE,
			height: 340,
			nodes: [
				{ id: 'e2', bounds: { ...BOUNDS, y: 140 } },
				{ id: 'e4', bounds: BOUNDS },
			],
			relations: [{ ...ROUTE, to: 'e4' }],
			lanes: [
				{ id: 'e7', regionId: 'e8', bounds: BOUNDS },
				{ id: 'e7', regionId: 'e9', bounds: { ...BOUNDS, width: 160 } },
			],
		};
		expect(geometryDifferences(BEFORE, after)).toEqual([
			{ part: GeometryPart.Canvas, id: '', change: GeometryChange.Changed },
			{ part: GeometryPart.Lane, id: 'e9/e7', change: GeometryChange.Changed },
			{ part: GeometryPart.Node, id: 'e1', change: GeometryChange.Removed },
			{ part: GeometryPart.Node, id: 'e2', change: GeometryChange.Changed },
			{ part: GeometryPart.Node, id: 'e4', change: GeometryChange.Added },
			{ part: GeometryPart.Relation, id: 'e3', change: GeometryChange.Changed },
		]);
	});

	it('tells a rerouted relation from an unchanged one', () => {
		const rerouted = {
			...BEFORE,
			relations: [{ ...ROUTE, points: [...ROUTE.points, { x: 60, y: 40 }] }],
		};
		expect(geometryDifferences(BEFORE, rerouted)).toEqual([
			{ part: GeometryPart.Relation, id: 'e3', change: GeometryChange.Changed },
		]);
	});
});
