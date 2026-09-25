import fc from 'fast-check';
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
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridge-contact';
import { routeRuns, validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
import { RegionPortalSide } from '../../../../src/lib/core/layout/region-composition-types';
import {
	RegionIncidentRejectionCode,
	RegionIncidentRole,
	RegionIncidentUnknownCode,
} from '../../../../src/lib/core/layout/region-incident-contract';
import {
	makeSharedLaneFrame,
	SHARED_LANE_CLEARANCE,
} from '../../../../src/lib/core/layout/shared-lane-frame';
import {
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
} from '../../../../src/lib/core/layout/shared-lane-geometry';
import { laneIncidentPathCandidates } from '../../../../src/lib/core/layout/shared-lane-incident-paths';
import { validateSharedLaneIncidentPath } from '../../../../src/lib/core/layout/shared-lane-incident-validation';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/shared-lane-ports';
import {
	allocateParallelRoutes,
	ParallelRouteOrder,
	routeSharedLanes,
} from '../../../../src/lib/core/layout/shared-lane-routing';
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
			lanes: ids.map((id, index) => ({
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
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

function parallelCandidate(document: LogicDocument, order: ParallelRouteOrder) {
	const prepared = prepareLayoutDocument(document);
	const routing = prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {});
	const input = defined(routing.input);
	const ports = planSharedLanePorts(input);
	const frame = makeSharedLaneFrame(input, ports, order !== ParallelRouteOrder.Canonical);
	let dimensions = { width: frame.longExtent, height: frame.crossExtent };
	if (input.vertical) dimensions = { width: frame.crossExtent, height: frame.longExtent };
	return {
		graph: prepared.graph,
		geometry: {
			...dimensions,
			lanes: frame.lanes,
			elements: frame.elements,
			relations: routeSharedLanes(input, frame, allocateParallelRoutes(input, frame), order),
		},
	};
}

function laneRouteMetrics(geometry: SharedLaneGeometry) {
	let length = 0;
	let bends = 0;
	for (const route of geometry.relations) {
		for (let index = 1; index < route.points.length; index += 1) {
			const previous = defined(route.points[index - 1]);
			const current = defined(route.points[index]);
			length += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
		}
		bends += Math.max(0, routeRuns(route).length - 1);
	}
	return { bridges: validatedBridges(geometry.relations).length, length, bends };
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
		const incident = {
			relation: { id: 'outer-incident', from: 'a1', to: 'external' },
			endpointId: 'a1',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Right],
		};
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [incident],
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.layout.relations.map(({ id }) => id)).toEqual(['inside', 'outer-local']);
		expect(selected.incidents).toHaveLength(1);
		expect(
			validateSharedLaneIncidentPath(selected.geometry, incident, defined(selected.incidents[0])),
		).toBeUndefined();
	});

	it('accepts an incident on a horizontal lane leaf and reports a missing endpoint', () => {
		const relation = [{ id: 'inside', from: 'a1', to: 'b1' }];
		const horizontal = laneDocument(LayoutDirection.LeftToRight, LayoutBias.Left, relation, 2);
		const horizontalPrepared = prepareLayoutDocument(horizontal);
		const horizontalIncident = {
			relation: { id: 'leaves-a', from: 'a1', to: 'external' },
			endpointId: 'a1',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Top],
		};
		const horizontalAttempt = solveSharedLaneLayout(
			horizontalPrepared.graph,
			horizontalPrepared.ranks,
			horizontalPrepared.measurements,
			{ incidents: [horizontalIncident] },
		);
		expect(horizontalAttempt.status).toBe(SharedLaneLayoutStatus.Selected);
		if (horizontalAttempt.status === SharedLaneLayoutStatus.Selected)
			expect(horizontalAttempt.incidents[0]?.side).toBe(RegionPortalSide.Top);
		const vertical = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, relation, 2);
		const verticalPrepared = prepareLayoutDocument(vertical);
		const missingEndpoint = solveSharedLaneLayout(
			verticalPrepared.graph,
			verticalPrepared.ranks,
			verticalPrepared.measurements,
			{
				incidents: [
					{
						relation: { id: 'missing-a', from: 'removed-a1', to: 'external' },
						endpointId: 'removed-a1',
						role: RegionIncidentRole.Source,
						allowedSides: [RegionPortalSide.Right],
					},
				],
			},
		);
		expect(missingEndpoint.status).toBe(SharedLaneLayoutStatus.Unknown);
		if (missingEndpoint.status !== SharedLaneLayoutStatus.Unknown) return;
		expect(missingEndpoint.code).toBe(RegionIncidentUnknownCode.NoValidAlternative);
		expect(missingEndpoint.witness.rejectedAlternatives[0]?.code).toBe(
			RegionIncidentRejectionCode.InvalidAttachment,
		);
	});

	it.each([
		[RegionPortalSide.Left, 'a1'],
		[RegionPortalSide.Right, 'b1'],
		[RegionPortalSide.Top, 'a1'],
		[RegionPortalSide.Bottom, 'b1'],
	] as const)('materializes a validated %s incident', (side, endpointId) => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const prepared = prepareLayoutDocument(document);
		const contract = {
			relation: { id: 'outer', from: endpointId, to: 'external' },
			endpointId,
			role: RegionIncidentRole.Source,
			allowedSides: [side],
		};
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [contract],
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		const path = defined(selected.incidents[0]);
		expect(path.side).toBe(side);
		expect(validateSharedLaneIncidentPath(selected.geometry, contract, path)).toBeUndefined();
	});

	it('rejects falsified lane incident identity, attachment, boundary and sharing', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const prepared = prepareLayoutDocument(document);
		const contract = {
			relation: { id: 'outer', from: 'a1', to: 'external' },
			endpointId: 'a1',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Left],
		};
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [contract],
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		const path = defined(selected.incidents[0]);
		const { geometry } = selected;
		expect(validateSharedLaneIncidentPath(geometry, contract, path)).toBeUndefined();
		expect(
			validateSharedLaneIncidentPath(geometry, { ...contract, endpointId: 'missing' }, path),
		).toMatchObject({ code: RegionIncidentRejectionCode.InvalidAttachment });
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				relationId: 'different',
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.InvalidAttachment });
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				points: [path.anchor],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				points: [],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				points: [path.anchor, { x: path.portal.x, y: path.portal.y + 1 }],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		const shiftedAnchor = { ...path.anchor, x: path.anchor.x + 1 };
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				anchor: shiftedAnchor,
				points: [shiftedAnchor, path.portal],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		const inward = { x: path.anchor.x + 1, y: path.anchor.y };
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				points: [path.anchor, inward, path.portal],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		const outside = { x: -1, y: path.portal.y };
		expect(
			validateSharedLaneIncidentPath(geometry, contract, {
				...path,
				portal: outside,
				points: [path.anchor, outside],
			}),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		const source = defined(geometry.elements.find(({ id }) => id === contract.endpointId));
		const blocker = {
			...source,
			id: 'blocker',
			bounds: {
				x: (path.anchor.x + path.portal.x) / 2 - 2,
				y: path.anchor.y - 2,
				width: 4,
				height: 4,
			},
		};
		expect(
			validateSharedLaneIncidentPath(
				{ ...geometry, elements: [...geometry.elements, blocker] },
				contract,
				path,
			),
		).toMatchObject({ code: RegionIncidentRejectionCode.RouteObstructed });
		expect(
			validateSharedLaneIncidentPath(
				{
					...geometry,
					relations: [
						{
							id: 'local-port',
							from: 'a1',
							to: 'other',
							points: [path.anchor, path.portal],
						},
					],
				},
				contract,
				path,
			),
		).toMatchObject({ code: RegionIncidentRejectionCode.PortUnavailable });
		expect(
			validateSharedLaneIncidentPath(
				{
					...geometry,
					relations: [
						{
							id: 'local-crossing',
							from: 'other',
							to: 'far',
							points: [path.anchor, path.portal],
						},
					],
				},
				contract,
				path,
			),
		).toMatchObject({ code: RegionIncidentRejectionCode.RouteObstructed });
		expect(
			validateSharedLaneIncidentPath(geometry, contract, path, [
				{ ...path, relationId: 'previous' },
			]),
		).toMatchObject({ code: RegionIncidentRejectionCode.RouteObstructed });
		const cramped = {
			...geometry,
			elements: geometry.elements.map((element) => {
				if (element.id === source.id) return { ...element, bounds: { ...element.bounds, x: 4 } };
				return element;
			}),
		};
		expect(
			laneIncidentPathCandidates(
				cramped,
				{
					offsetByIncidence: new Map(),
					demandByEndpoint: new Map(),
					incidentOffsetByFace: new Map(),
				},
				contract,
				RegionPortalSide.Left,
			),
		).toHaveLength(1);
	});

	it('tries a bounded detour before changing the requested side', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const prepared = prepareLayoutDocument(document);
		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [
				{
					relation: { id: 'outer', from: 'a1', to: 'external' },
					endpointId: 'a1',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Right, RegionPortalSide.Left],
				},
			],
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.incidents[0]?.side).toBe(RegionPortalSide.Right);
		expect(selected.incidents[0]?.points).toHaveLength(4);
		expect(selected.witness.attempted).toBeGreaterThan(1);
		expect(selected.witness.exhaustive).toBe(false);
		expect(selected.witness.rejectedAlternatives[0]).toMatchObject({
			side: RegionPortalSide.Right,
			candidateId: 'parallel/reserved-top-passage/direct',
			code: RegionIncidentRejectionCode.RouteObstructed,
		});
	});

	it('reserves distinct ports for source and target incidents on one face', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const prepared = prepareLayoutDocument(document);
		const source = {
			relation: { id: 'outer-source', from: 'b1', to: 'external-a' },
			endpointId: 'b1',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Right],
		};
		const target = {
			relation: { id: 'outer-target', from: 'external-b', to: 'b1' },
			endpointId: 'b1',
			role: RegionIncidentRole.Target,
			allowedSides: [RegionPortalSide.Right],
		};
		const solveIncidents = (incidents: readonly (typeof source | typeof target)[]) =>
			solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, { incidents });
		const selected = solveIncidents([target, source]);
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		expect(solveIncidents([source, target])).toEqual(selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.incidents.map(({ relationId }) => relationId)).toEqual([
			'outer-source',
			'outer-target',
		]);
		const [first, second] = selected.incidents;
		expect(Math.abs(defined(first).anchor.y - defined(second).anchor.y)).toBe(48);
		expect(
			validateSharedLaneIncidentPath(selected.geometry, source, defined(first)),
		).toBeUndefined();
		expect(
			validateSharedLaneIncidentPath(selected.geometry, target, defined(second), [defined(first)]),
		).toBeUndefined();
	});

	it.each([
		[LaneOrientation.Parallel, RegionPortalSide.Left],
		[LaneOrientation.Transverse, RegionPortalSide.Top],
	] as const)('reports an incomplete %s incident search', (orientation, side) => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const document: LogicDocument = {
			...base,
			presentation: { ...defined(base.presentation), laneOrientation: orientation },
		};
		const prepared = prepareLayoutDocument(document);
		const incidents = Array.from({ length: 257 }, (_, index) => ({
			relation: { id: `outer-${index}`, from: 'a1', to: `external-${index}` },
			endpointId: 'a1',
			role: RegionIncidentRole.Source,
			allowedSides: [side],
		}));
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents,
		});
		expect(result.status).toBe(SharedLaneLayoutStatus.Unknown);
		if (result.status !== SharedLaneLayoutStatus.Unknown) return;
		expect(result.code).toBe(RegionIncidentUnknownCode.SearchBudgetExceeded);
		expect(result.witness.attempted).toBe(256);
		expect(result.witness.exhaustive).toBe(false);
	});

	it('exhausts earlier routes when a later incident has no local endpoint', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [
				{
					relation: { id: 'a-valid', from: 'a1', to: 'external' },
					endpointId: 'a1',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Left],
				},
				{
					relation: { id: 'z-missing', from: 'missing', to: 'external' },
					endpointId: 'missing',
					role: RegionIncidentRole.Source,
					allowedSides: [RegionPortalSide.Right],
				},
			],
		});
		expect(result.status).toBe(SharedLaneLayoutStatus.Unknown);
		if (result.status !== SharedLaneLayoutStatus.Unknown) return;
		expect(result.code).toBe(RegionIncidentUnknownCode.NoValidAlternative);
		expect(result.witness.exhaustive).toBe(true);
		expect(result.witness.rejectedAlternatives).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					relationId: 'z-missing',
					code: RegionIncidentRejectionCode.InvalidAttachment,
				}),
				expect.objectContaining({
					relationId: 'a-valid',
					code: RegionIncidentRejectionCode.RouteObstructed,
				}),
			]),
		);
	});

	it('keeps two incident paths deterministic under measured sizes and collection order', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 56, max: 220 }),
				fc.integer({ min: 56, max: 220 }),
				(width, height) => {
					const original = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
					const permuted = {
						...original,
						nodes: [...original.nodes].reverse(),
					};
					const contracts = [
						{
							relation: { id: 'out-a', from: 'b1', to: 'external-a' },
							endpointId: 'b1',
							role: RegionIncidentRole.Source,
							allowedSides: [RegionPortalSide.Right],
						},
						{
							relation: { id: 'out-b', from: 'external-b', to: 'b1' },
							endpointId: 'b1',
							role: RegionIncidentRole.Target,
							allowedSides: [RegionPortalSide.Right],
						},
					] as const;
					const solveVariant = (document: LogicDocument, reverse: boolean) => {
						const prepared = prepareLayoutDocument(document);
						const nodes = new Map(prepared.measurements.nodes);
						nodes.set('b1', { width, height });
						let incidents: readonly (typeof contracts)[number][] = contracts;
						if (reverse) incidents = [...contracts].reverse();
						return solveSharedLaneLayout(
							prepared.graph,
							prepared.ranks,
							{ ...prepared.measurements, nodes },
							{ incidents },
						);
					};
					const selected = solveVariant(original, false);
					expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
					expect(solveVariant(permuted, true)).toEqual(selected);
					if (selected.status !== SharedLaneLayoutStatus.Selected) return;
					for (const [index, path] of selected.incidents.entries()) {
						const contract = defined(contracts[index]);
						const earlier = selected.incidents.slice(0, index);
						expect(
							validateSharedLaneIncidentPath(selected.geometry, contract, path, earlier),
						).toBeUndefined();
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it('selects a three-dependency crossing through validated bridges in the second pass', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'within-a', from: 'a1', to: 'a2' },
			{ id: 'a1-to-b', from: 'a1', to: 'b1' },
			{ id: 'a2-to-b', from: 'a2', to: 'b1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		// The first pass still forbids the very same geometry: bridges are only admitted by pass 2.
		expect(
			validateSharedLaneGeometry(prepared.graph, result.geometry, SHARED_LANE_CLEARANCE),
		).toContain('cross without a bridge');
		expect(
			validateSharedLaneGeometry(prepared.graph, result.geometry, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();
		const bridges = validatedBridges(result.geometry.relations);
		expect(bridges).toHaveLength(1);
		const metrics = laneRouteMetrics(result.geometry);
		expect(metrics.length).toBeLessThanOrEqual(2392);
		expect(metrics.bends).toBeLessThanOrEqual(10);
		for (const [index, route] of result.geometry.relations.entries())
			for (const other of result.geometry.relations.slice(index + 1))
				expect(unbridgedContacts(route, other, bridges)).toEqual([]);
	});

	it('types an invalid incident contract before any geometry', () => {
		const prepared = prepareLayoutDocument(
			laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
				{ id: 'a-to-b', from: 'a1', to: 'b1' },
			]),
		);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents: [
				{
					relation: { id: 'a-to-b', from: 'a1', to: 'b1' },
					endpointId: 'a1',
					role: RegionIncidentRole.Source,
					allowedSides: [],
				},
			],
		});
		expect(result).toMatchObject({
			status: SharedLaneLayoutStatus.Unknown,
			code: RegionIncidentUnknownCode.InvalidContract,
			reason: 'An incident must admit at least one frame side.',
			witness: { attempted: 0, exhaustive: true, rejectedAlternatives: [] },
		});
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
				obstacle: {
					minimumWidth: 180,
					minimumHeight: 180,
					headerHeight: 36,
					padding: 24,
				},
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
		const empty: LogicDocument = {
			...base,
			nodes: [],
			groups: [],
			relations: [],
		};
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
		const reversed = solveRaw({
			...parallel,
			relations: [...parallel.relations].reverse(),
		});
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
			nodes: base.nodes.map((node) => ({
				...node,
				layoutOrder: orderKey('a0'),
			})),
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
			relations: [
				{
					...route,
					points: [{ ...first, x: first.x + 1 }, ...route.points.slice(1)],
				},
			],
		};
		expect(validateSharedLaneGeometry(prepared.graph, altered)).toContain('wrong source face');
	});
	it('chooses the shorter bridge-free LocalPassages candidate over Canonical', () => {
		const document = laneDocument(
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
			[{ id: 'a-to-b', from: 'a1', to: 'b1' }],
			2,
		);
		const canonical = parallelCandidate(document, ParallelRouteOrder.Canonical);
		const local = parallelCandidate(document, ParallelRouteOrder.LocalPassages);
		const canonicalMetrics = laneRouteMetrics(canonical.geometry);
		const localMetrics = laneRouteMetrics(local.geometry);
		expect(validateSharedLaneGeometry(canonical.graph, canonical.geometry)).toBeUndefined();
		expect(validateSharedLaneGeometry(local.graph, local.geometry)).toBeUndefined();
		expect(canonicalMetrics.bridges).toBe(0);
		expect(localMetrics.bridges).toBe(0);
		expect(localMetrics.length).toBeLessThan(canonicalMetrics.length);
		expect(localMetrics.bends).toBeLessThan(canonicalMetrics.bends);
		const selected = solve(document);
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(laneRouteMetrics(selected.geometry)).toEqual(localMetrics);
	});
});
