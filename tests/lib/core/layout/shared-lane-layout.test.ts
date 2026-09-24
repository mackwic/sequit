import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/shared-lane-geometry';
import { validateSharedLaneOutgoingIncident } from '../../../../src/lib/core/layout/shared-lane-incident-validation';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

function laneDocument(
	direction: LayoutDirection,
	bias: LayoutBias,
	relations: readonly LogicRelation[],
	laneCount = 3,
): LogicDocument {
	const ids = ['A', 'B', 'C'].slice(0, laneCount);
	const nodes: LogicDocument['nodes'][number][] = [
		{
			kind: EndpointKind.Node,
			id: 'a1',
			natureId: 'task',
			laneId: 'A',
			markdown: 'A1',
			layoutOrder: orderKey('a0'),
		},
		{
			kind: EndpointKind.Node,
			id: 'a2',
			natureId: 'task',
			laneId: 'A',
			markdown: 'A2',
			layoutOrder: orderKey('a1'),
		},
		{
			kind: EndpointKind.Node,
			id: 'b1',
			natureId: 'task',
			laneId: 'B',
			markdown: 'B1',
			layoutOrder: orderKey('a2'),
		},
	];
	if (laneCount === 3)
		nodes.push({
			kind: EndpointKind.Node,
			id: 'c1',
			natureId: 'task',
			laneId: 'C',
			markdown: 'C1',
			layoutOrder: orderKey('a3'),
		});
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'shared-lanes',
		title: 'Shared lanes',
		layout: defined(layoutConfiguration(direction, bias)),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: ids.map((id, index) => ({ id, label: id, layoutOrder: orderKey(`a${index}`) })),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes,
		junctions: [],
		relations,
	};
}

function solve(document: LogicDocument) {
	const prepared = prepareLayoutDocument(document);
	return solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
}

function solveRaw(document: LogicDocument) {
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Expected a graph');
	return solveSharedLaneLayout(
		graph.value,
		topologicallyRank(graph.value),
		layoutMeasurementsFor(document),
	);
}

describe('shared lane layout', () => {
	it('keeps an unrelated local lane relation clear of a reserved outgoing passage', () => {
		const source = laneDocument(
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
			[
				{ id: 'inside', from: 'a1', to: 'b1' },
				{ id: 'outer-local', from: 'b1', to: 'b2' },
			],
			2,
		);
		const b1 = defined(source.nodes.find(({ id }) => id === 'b1'));
		const document: LogicDocument = {
			...source,
			nodes: [
				...source.nodes.filter(({ id }) => id !== 'a2'),
				{ ...b1, id: 'b2', markdown: 'B2', layoutOrder: orderKey('a4') },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const incident = { relationId: 'outer-incident', endpointId: 'a1', side: 1 } as const;
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			outgoingIncident: incident,
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.layout.relations.map(({ id }) => id)).toEqual(['inside', 'outer-local']);
		expect(validateSharedLaneOutgoingIncident(selected.geometry, incident)).toBeUndefined();
	});

	it('refuses an outgoing incident contract with the wrong axis or a missing source', () => {
		const relation = [{ id: 'inside', from: 'a1', to: 'b1' }];
		const horizontal = laneDocument(LayoutDirection.LeftToRight, LayoutBias.Left, relation, 2);
		const horizontalPrepared = prepareLayoutDocument(horizontal);
		expect(
			solveSharedLaneLayout(
				horizontalPrepared.graph,
				horizontalPrepared.ranks,
				horizontalPrepared.measurements,
				{
					outgoingIncident: { relationId: 'leaves-a', endpointId: 'a1', side: 1 },
				},
			),
		).toEqual({
			status: SharedLaneLayoutStatus.Unsupported,
			reason: 'A right-facing lane incident requires top-to-bottom parallel lanes.',
		});
		const vertical = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, relation, 2);
		const verticalPrepared = prepareLayoutDocument(vertical);
		expect(
			solveSharedLaneLayout(
				verticalPrepared.graph,
				verticalPrepared.ranks,
				verticalPrepared.measurements,
				{
					outgoingIncident: { relationId: 'leaves-a', endpointId: 'removed-a1', side: 1 },
				},
			),
		).toEqual({
			status: SharedLaneLayoutStatus.Unsupported,
			reason: 'Incident leaves-a has no local source endpoint.',
		});
	});

	it('keeps an unresolved three-dependency crossing typed as unknown', () => {
		const result = solve(
			laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
				{ id: 'within-a', from: 'a1', to: 'a2' },
				{ id: 'a1-to-b', from: 'a1', to: 'b1' },
				{ id: 'a2-to-b', from: 'a2', to: 'b1' },
			]),
		);
		expect(result.status).toBe(SharedLaneLayoutStatus.Unknown);
		if (result.status !== SharedLaneLayoutStatus.Unknown) return;
		expect(result.reason).toContain('cross without a bridge');
	});
	it.each(DIRECTIONS)('places and routes A→C through the shared frame in %s', (direction, bias) => {
		const document = laneDocument(direction, bias, [{ id: 'a-to-c', from: 'a1', to: 'c1' }]);
		const withObstacle: LogicDocument = {
			...document,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'obstacle',
					label: 'Obstacle',
					laneId: 'B',
					layoutOrder: orderKey('a4'),
				},
			],
		};
		const prepared = prepareLayoutDocument(withObstacle, {
			groups: {
				obstacle: { minimumWidth: 180, minimumHeight: 180, headerHeight: 36, padding: 24 },
			},
		});
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.lanes?.map(({ id }) => id)).toEqual(['A', 'B', 'C']);
		expect(result.layout.elements.map(({ id }) => id)).toContain('obstacle');
		expect(result.layout.relations).toHaveLength(1);
		expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
	});

	it('routes ordinary intra-lane dependencies through an adjacent gutter', () => {
		const document = laneDocument(
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
			[{ id: 'a1-to-a2', from: 'a1', to: 'a2' }],
			2,
		);
		const result = solve(document);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.relations[0]?.points).toHaveLength(4);
	});

	it('routes a same-lane dependency on the rightmost lane from its inward face', () => {
		const source = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'c1-to-c2', from: 'c1', to: 'c2' },
		]);
		const document: LogicDocument = {
			...source,
			nodes: [
				...source.nodes,
				{
					kind: EndpointKind.Node,
					id: 'c2',
					natureId: 'task',
					laneId: 'C',
					markdown: 'C2',
					layoutOrder: orderKey('a4'),
				},
			],
		};
		const result = solve(document);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
	});

	it.each([
		['forward', 'a1', 'c1'],
		['reverse', 'c1', 'a1'],
	] as const)('accepts %s cross-lane dependencies', (_label, from, to) => {
		const result = solve(
			laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [{ id: 'cross', from, to }]),
		);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
	});

	it('routes two linked inter-lane dependencies in one solve', () => {
		const result = solve(
			laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
				{ id: 'a-to-b', from: 'a1', to: 'b1' },
				{ id: 'b-to-c', from: 'b1', to: 'c1' },
			]),
		);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(result.layout.relations.map(({ id }) => id)).toEqual(['a-to-b', 'b-to-c']);
	});

	it('resolves two legal dependencies through local parallel passages', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-c', from: 'a1', to: 'c1' },
			{ id: 'b-to-c', from: 'b1', to: 'c1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
	});

	it('is deterministic under collection permutations and changes lane width with measurements', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-c', from: 'a1', to: 'c1' },
		]);
		const permuted: LogicDocument = {
			...document,
			presentation: {
				...defined(document.presentation),
				lanes: [...defined(document.presentation).lanes].reverse(),
			},
			nodes: [...document.nodes].reverse(),
		};
		const baseline = solve(document);
		const reordered = solve(permuted);
		expect(reordered).toEqual(baseline);
		const prepared = prepareLayoutDocument(document, {
			nodes: { a1: { width: 400, height: 116 } },
		});
		const enlarged = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(enlarged.status).toBe(SharedLaneLayoutStatus.Selected);
		if (baseline.status !== SharedLaneLayoutStatus.Selected) return;
		if (enlarged.status !== SharedLaneLayoutStatus.Selected) return;
		expect(enlarged.layout.width).toBeGreaterThan(baseline.layout.width);
	});

	it('reports unsupported junctions without using the dedicated policy', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const withJunction: LogicDocument = {
			...document,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'j',
					operator: JunctionOperator.Xor,
					laneId: 'B',
					layoutOrder: orderKey('a4'),
				},
			],
		};
		const result = solve(withJunction);
		expect(result.status).toBe(SharedLaneLayoutStatus.Unsupported);
	});

	it('accepts transverse lanes and zero relations', () => {
		const document = laneDocument(LayoutDirection.LeftToRight, LayoutBias.Left, []);
		expect(solve(document).status).toBe(SharedLaneLayoutStatus.Selected);
		const transverse: LogicDocument = {
			...document,
			presentation: {
				...defined(document.presentation),
				laneOrientation: LaneOrientation.Transverse,
			},
		};
		expect(solve(transverse).status).toBe(SharedLaneLayoutStatus.Selected);
	});

	it('reports presentation, cardinality and ownership boundaries as unsupported', () => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const presentation = defined(base.presentation);
		const noPresentation: LogicDocument = { ...base };
		Reflect.deleteProperty(noPresentation, 'presentation');
		const oneLane: LogicDocument = {
			...base,
			presentation: { ...presentation, lanes: presentation.lanes.slice(0, 1) },
		};
		const fourLanes: LogicDocument = {
			...base,
			presentation: {
				...presentation,
				lanes: [...presentation.lanes, { id: 'D', label: 'D', layoutOrder: orderKey('a4') }],
			},
		};
		const unassigned: LogicDocument = {
			...base,
			nodes: base.nodes.map((node) => {
				if (node.id !== 'a1') return node;
				const unassignedNode = { ...node };
				Reflect.deleteProperty(unassignedNode, 'laneId');
				return unassignedNode;
			}),
		};
		const wrongLane: LogicDocument = {
			...base,
			nodes: base.nodes.map((node) => {
				if (node.id !== 'a1') return node;
				return { ...node, laneId: 'wrong' };
			}),
		};
		for (const candidate of [noPresentation, oneLane, fourLanes, unassigned, wrongLane])
			expect(solveRaw(candidate).status).toBe(SharedLaneLayoutStatus.Unsupported);
		const prepared = prepareLayoutDocument(base);
		expect(
			solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
				inspectRouting: true,
			}).status,
		).toBe(SharedLaneLayoutStatus.Unsupported);
	});

	it('reports descendants and missing measurements at their input boundary', () => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const parent = {
			kind: EndpointKind.Group,
			id: 'parent',
			label: 'Parent',
			laneId: 'B',
			layoutOrder: orderKey('a4'),
		} as const;
		const nested: LogicDocument = {
			...base,
			groups: [
				parent,
				{
					kind: EndpointKind.Group,
					id: 'child',
					label: 'Child',
					groupId: 'parent',
					layoutOrder: orderKey('a5'),
				},
			],
		};
		const groupedNode: LogicDocument = {
			...base,
			groups: [parent],
			nodes: base.nodes.map((node) => {
				if (node.id !== 'a1') return node;
				return { ...node, groupId: 'parent' };
			}),
		};
		expect(solveRaw(nested).status).toBe(SharedLaneLayoutStatus.Unsupported);
		expect(solveRaw(groupedNode).status).toBe(SharedLaneLayoutStatus.Unsupported);
		const prepared = prepareLayoutDocument(base);
		const noNodes = { ...prepared.measurements, nodes: new Map() };
		expect(() => solveSharedLaneLayout(prepared.graph, prepared.ranks, noNodes)).toThrow(
			'Missing node measurement',
		);
		const groupDocument: LogicDocument = { ...base, groups: [parent] };
		const groupPrepared = prepareLayoutDocument(groupDocument);
		const noGroups = { ...groupPrepared.measurements, groups: new Map() };
		expect(() => solveSharedLaneLayout(groupPrepared.graph, groupPrepared.ranks, noGroups)).toThrow(
			'Missing group measurement',
		);
	});

	it('keeps two empty auto-growing lanes and ranks parallel dependencies deterministically', () => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const empty: LogicDocument = { ...base, nodes: [], groups: [], relations: [] };
		expect(solveRaw(empty).status).toBe(SharedLaneLayoutStatus.Selected);
		const parallel: LogicDocument = {
			...base,
			relations: [
				{ id: 'a-to-b-2', from: 'a1', to: 'b1' },
				{ id: 'a-to-b-1', from: 'a1', to: 'b1' },
				{ id: 'a-to-c', from: 'a1', to: 'c1' },
			],
		};
		const first = solveRaw(parallel);
		const reversed = solveRaw({ ...parallel, relations: [...parallel.relations].reverse() });
		expect(reversed).toEqual(first);
	});

	it('orders same-source passages by target row and resolves equal order keys by ID', () => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const ranked: LogicDocument = {
			...base,
			relations: [
				{ id: 'a-to-b', from: 'a1', to: 'b1' },
				{ id: 'a-to-c', from: 'a1', to: 'c1' },
				{ id: 'b-to-c', from: 'b1', to: 'c1' },
			],
		};
		expect(solveRaw({ ...ranked, relations: [...ranked.relations].reverse() })).toEqual(
			solveRaw(ranked),
		);
		const lanes = defined(base.presentation).lanes;
		const equalOrders: LogicDocument = {
			...base,
			presentation: {
				...defined(base.presentation),
				lanes: lanes.map((lane) => ({ ...lane, layoutOrder: orderKey('a0') })),
			},
			nodes: base.nodes.map((node) => ({ ...node, layoutOrder: orderKey('a0') })),
		};
		expect(solve(equalOrders).status).toBe(SharedLaneLayoutStatus.Selected);
	});

	it('rejects an altered box that escapes its lane', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, []);
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		const first = defined(result.geometry.elements[0]);
		const altered = {
			...result.geometry,
			elements: [
				{ ...first, bounds: { ...first.bounds, x: -1000 } },
				...result.geometry.elements.slice(1),
			],
		};
		expect(validateSharedLaneGeometry(prepared.graph, altered)).toContain('escapes its lane');
	});

	it('rejects a route that detaches from its source port', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a-to-c', from: 'a1', to: 'c1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		const route = defined(result.geometry.relations[0]);
		const first = defined(route.points[0]);
		const altered = {
			...result.geometry,
			relations: [{ ...route, points: [{ ...first, x: first.x + 1 }, ...route.points.slice(1)] }],
		};
		expect(validateSharedLaneGeometry(prepared.graph, altered)).toContain('wrong source face');
	});
});
