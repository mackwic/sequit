import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import type {
	LayoutElement,
	LayoutRelation,
	Point,
} from '../../../../src/lib/core/layout/layout-types';
import {
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
} from '../../../../src/lib/core/layout/shared-lane-geometry';
import { segmentsContact } from '../../../../src/lib/core/layout/shared-lane-geometry-primitives';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function document(): LogicDocument {
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'geometry-witness',
		title: 'Geometry witness',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: ['A', 'B', 'C'].map((id, index) => ({
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'obstacle',
				label: 'Obstacle',
				laneId: 'B',
				layoutOrder: orderKey('a4'),
			},
		],
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'a',
				natureId: 'task',
				markdown: 'A',
				laneId: 'A',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 'a2',
				natureId: 'task',
				markdown: 'A2',
				laneId: 'A',
				layoutOrder: orderKey('a1'),
			},
			{
				kind: EndpointKind.Node,
				id: 'c',
				natureId: 'task',
				markdown: 'C',
				laneId: 'C',
				layoutOrder: orderKey('a2'),
			},
		],
		junctions: [],
		relations: [{ id: 'a-to-c', from: 'a', to: 'c' }],
	};
}

function witness(): { readonly graph: LogicGraph; readonly geometry: SharedLaneGeometry } {
	const prepared = prepareLayoutDocument(document(), {
		groups: { obstacle: { minimumWidth: 180, minimumHeight: 180, headerHeight: 36, padding: 24 } },
	});
	const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
	if (result.status !== SharedLaneLayoutStatus.Selected)
		throw new Error('Expected selected witness');
	return { graph: prepared.graph, geometry: result.geometry };
}

function laneAt(
	geometry: SharedLaneGeometry,
	index: number,
	transform: (lane: SharedLaneGeometry['lanes'][number]) => SharedLaneGeometry['lanes'][number],
): SharedLaneGeometry {
	return {
		...geometry,
		lanes: geometry.lanes.map((lane, at) => {
			if (at === index) return transform(lane);
			return lane;
		}),
	};
}

function boxAt(
	geometry: SharedLaneGeometry,
	index: number,
	transform: (box: LayoutElement) => LayoutElement,
): SharedLaneGeometry {
	return {
		...geometry,
		elements: geometry.elements.map((box, at) => {
			if (at === index) return transform(box);
			return box;
		}),
	};
}

function routeAt(
	geometry: SharedLaneGeometry,
	transform: (route: LayoutRelation) => LayoutRelation,
): SharedLaneGeometry {
	return { ...geometry, relations: geometry.relations.map(transform) };
}

function pointAt(
	route: LayoutRelation,
	index: number,
	transform: (point: Point) => Point,
): LayoutRelation {
	return {
		...route,
		points: route.points.map((point, at) => {
			if (at === index) return transform(point);
			return point;
		}),
	};
}

describe('independent shared lane geometry validation', () => {
	it.each([
		[
			'missing lane',
			(g: SharedLaneGeometry) => ({ ...g, lanes: g.lanes.slice(1) }),
			'lane set is incomplete',
		],
		[
			'wrong lane identity',
			(g: SharedLaneGeometry) => laneAt(g, 0, (lane) => ({ ...lane, id: 'wrong' })),
			'Lane order or identity',
		],
		[
			'degenerate lane',
			(g: SharedLaneGeometry) =>
				laneAt(g, 0, (lane) => ({ ...lane, bounds: { ...lane.bounds, width: 0 } })),
			'invalid bounds',
		],
		[
			'non-finite lane',
			(g: SharedLaneGeometry) =>
				laneAt(g, 0, (lane) => ({ ...lane, bounds: { ...lane.bounds, x: Number.NaN } })),
			'invalid bounds',
		],
		[
			'lane outside canvas',
			(g: SharedLaneGeometry) =>
				laneAt(g, 0, (lane) => ({ ...lane, bounds: { ...lane.bounds, x: -1 } })),
			'escapes the canvas',
		],
		[
			'overlapping lanes',
			(g: SharedLaneGeometry) =>
				laneAt(g, 1, (lane) => ({ ...lane, bounds: { ...lane.bounds, x: 100 } })),
			'overlaps its predecessor',
		],
		[
			'missing box',
			(g: SharedLaneGeometry) => ({ ...g, elements: g.elements.slice(1) }),
			'element set is incomplete',
		],
		[
			'duplicate box',
			(g: SharedLaneGeometry) => ({
				...g,
				elements: [defined(g.elements[0]), defined(g.elements[0]), ...g.elements.slice(2)],
			}),
			'contains duplicates',
		],
		[
			'wrong box kind',
			(g: SharedLaneGeometry) => boxAt(g, 0, (box) => ({ ...box, kind: EndpointKind.Junction })),
			'kind differs',
		],
		[
			'degenerate box',
			(g: SharedLaneGeometry) =>
				boxAt(g, 0, (box) => ({ ...box, bounds: { ...box.bounds, height: 0 } })),
			'invalid bounds',
		],
		[
			'box outside lane',
			(g: SharedLaneGeometry) =>
				boxAt(g, 0, (box) => ({ ...box, bounds: { ...box.bounds, x: -1000 } })),
			'escapes its lane',
		],
		[
			'overlapping boxes',
			(g: SharedLaneGeometry) =>
				boxAt(g, 1, (box) => ({ ...box, bounds: defined(g.elements[0]).bounds })),
			'overlap',
		],
		['non-finite canvas', (g: SharedLaneGeometry) => ({ ...g, width: Number.NaN }), 'non-finite'],
		['non-finite height', (g: SharedLaneGeometry) => ({ ...g, height: Number.NaN }), 'non-finite'],
		['non-positive canvas', (g: SharedLaneGeometry) => ({ ...g, width: 0 }), 'non-positive'],
	] as const)('%s', (_name, mutate, expected) => {
		const { graph, geometry } = witness();
		expect(validateSharedLaneGeometry(graph, mutate(geometry))).toContain(expected);
	});

	it.each([
		[
			'missing route',
			(g: SharedLaneGeometry) => ({ ...g, relations: [] }),
			'relation set is incomplete',
		],
		[
			'unknown route',
			(g: SharedLaneGeometry) => routeAt(g, (route) => ({ ...route, id: 'unknown' })),
			'Route identity differs',
		],
		[
			'wrong endpoints',
			(g: SharedLaneGeometry) => routeAt(g, (route) => ({ ...route, from: 'c' })),
			'Route endpoints differ',
		],
		[
			'empty route',
			(g: SharedLaneGeometry) => routeAt(g, (route) => ({ ...route, points: [] })),
			'is empty',
		],
		[
			'short route',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => ({ ...route, points: route.points.slice(0, 1) })),
			'is empty',
		],
		[
			'wrong target face',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 5, (point) => ({ ...point, x: point.x + 1 }))),
			'wrong target face',
		],
		[
			'inward source',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 1, (point) => ({ ...point, x: point.x - 200 }))),
			'leaves the source inward',
		],
		[
			'longitudinal source departure',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 1, (point) => ({ ...point, y: point.y + 1 }))),
			'leaves the source inward',
		],
		[
			'inward target',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 4, (point) => ({ ...point, x: point.x + 200 }))),
			'reaches the target from inside',
		],
		[
			'diagonal segment',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 2, (point) => ({ ...point, x: point.x + 1 }))),
			'non-orthogonal',
		],
		[
			'non-finite route coordinate',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => pointAt(route, 2, (point) => ({ ...point, y: Number.NaN }))),
			'non-orthogonal',
		],
		[
			'outside canvas',
			(g: SharedLaneGeometry) =>
				routeAt(g, (route) => ({
					...route,
					points: route.points.map((point, at) => {
						if (at === 2 || at === 3) return { ...point, y: -1 };
						return point;
					}),
				})),
			'escapes the canvas',
		],
	] as const)('%s', (_name, mutate, expected) => {
		const { graph, geometry } = witness();
		expect(validateSharedLaneGeometry(graph, mutate(geometry))).toContain(expected);
	});

	it('rejects a route through an obstacle in the intervening lane', () => {
		const { graph, geometry } = witness();
		const obstacle = geometry.elements.find(({ id }) => id === 'obstacle');
		if (obstacle === undefined) throw new Error('Missing obstacle');
		const obstacleLong = obstacle.bounds.y + obstacle.bounds.height / 2;
		const altered = routeAt(geometry, (route) => ({
			...route,
			points: route.points.map((point, at) => {
				if (at === 2 || at === 3) return { ...point, y: obstacleLong };
				return point;
			}),
		}));
		expect(validateSharedLaneGeometry(graph, altered)).toContain('touches element obstacle');
	});

	it('rejects a route that loops across its own gutter', () => {
		const { graph, geometry } = witness();
		const altered = routeAt(geometry, (route) => {
			const start = defined(route.points[0]);
			const gutter = defined(route.points[1]);
			const track = defined(route.points[2]);
			const targetGutter = defined(route.points[3]);
			const approach = defined(route.points[4]);
			const end = defined(route.points[5]);
			return {
				...route,
				points: [
					start,
					gutter,
					track,
					{ x: gutter.x - 10, y: track.y },
					{ x: gutter.x - 10, y: start.y + 10 },
					{ x: gutter.x + 10, y: start.y + 10 },
					{ x: gutter.x + 10, y: track.y + 10 },
					{ x: targetGutter.x, y: track.y + 10 },
					approach,
					end,
				],
			};
		});
		expect(validateSharedLaneGeometry(graph, altered)).toContain('crosses itself');
	});

	it('rejects two routes sharing an exact port without spacing', () => {
		const { geometry } = witness();
		const double: LogicDocument = {
			...document(),
			relations: [
				{ id: 'first', from: 'a', to: 'c' },
				{ id: 'second', from: 'a', to: 'c' },
			],
		};
		const graph = prepareLayoutDocument(double).graph;
		const route = defined(geometry.relations[0]);
		const duplicated = {
			...geometry,
			relations: [
				{ ...route, id: 'first' },
				{ ...route, id: 'second' },
			],
		};
		expect(validateSharedLaneGeometry(graph, duplicated)).toContain('too close');
	});

	it('rejects parallel lane geometry claimed for transverse presentation', () => {
		const { geometry } = witness();
		const source = document();
		const transverse: LogicDocument = {
			...source,
			presentation: {
				...defined(source.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
		};
		const graph = prepareLayoutDocument(transverse).graph;
		expect(validateSharedLaneGeometry(graph, geometry)).toContain('overlaps its predecessor');
	});

	it('requires an explicit presentation before checking a shared candidate', () => {
		const { geometry } = witness();
		const legacy = prepareLayoutDocument(validLogicDocument());
		expect(validateSharedLaneGeometry(legacy.graph, geometry)).toContain(
			'Explicit lanes are required',
		);
	});

	it('recognizes an overlapping vertical segment as a route contact', () => {
		expect(
			segmentsContact({ x: 10, y: 0 }, { x: 10, y: 30 }, { x: 10, y: 20 }, { x: 10, y: 40 }),
		).toBe(true);
	});

	it('rejects sparse route points before treating the candidate as valid', () => {
		const { graph, geometry } = witness();
		const missingLast = routeAt(geometry, (route) => {
			const points = new Array<Point>(3);
			points[0] = defined(route.points[0]);
			points[1] = defined(route.points[1]);
			return { ...route, points };
		});
		expect(validateSharedLaneGeometry(graph, missingLast)).toContain('is empty');
		const missingMiddle = routeAt(geometry, (route) => {
			const points = [...route.points];
			Reflect.deleteProperty(points, '2');
			return { ...route, points };
		});
		expect(validateSharedLaneGeometry(graph, missingMiddle)).toContain('is incomplete');
	});
});
