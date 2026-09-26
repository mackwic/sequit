import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
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
	certifySharedLaneGeometry,
	type SharedLaneGeometry,
	validateSharedLaneGeometry,
	validateSharedLaneGeometryWithCertificate,
} from '../../../../src/lib/core/layout/shared-lane-geometry';
import { laneIncidentPathCandidates } from '../../../../src/lib/core/layout/shared-lane-incident-paths';
import { searchLaneIncidentPaths } from '../../../../src/lib/core/layout/shared-lane-incident-search';
import { validateSharedLaneIncidentPath } from '../../../../src/lib/core/layout/shared-lane-incident-validation';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/shared-lane-layout';
import { prepareSharedLanes } from '../../../../src/lib/core/layout/shared-lane-model';
import { planSharedLanePorts } from '../../../../src/lib/core/layout/shared-lane-ports';
import {
	laneRouteSelectionIsBetter,
	materializeParallelGeometry,
	parallelRouteCandidates,
	parallelStrategyPlans,
	rankLaneRouteSelection,
} from '../../../../src/lib/core/layout/shared-lane-route-candidates';
import {
	certifySharedLaneRouteGeometry,
	materializeParallelGeometryDelta,
	validateSharedLaneGeometryDelta,
} from '../../../../src/lib/core/layout/shared-lane-route-delta';
import { searchParallelRouteAllocations } from '../../../../src/lib/core/layout/shared-lane-route-search';
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

function fourRouteCrossingDocument(): LogicDocument {
	const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [], 2);
	const b1 = defined(base.nodes.find(({ id }) => id === 'b1'));
	return {
		...base,
		nodes: [...base.nodes, { ...b1, id: 'b2', markdown: 'B2', layoutOrder: orderKey('a3') }],
		relations: [
			{ id: 'a1-to-b1', from: 'a1', to: 'b1' },
			{ id: 'a1-to-b2', from: 'a1', to: 'b2' },
			{ id: 'a2-to-b1', from: 'a2', to: 'b1' },
			{ id: 'a2-to-b2', from: 'a2', to: 'b2' },
		],
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

	it('rejects falsified lane incidents while permitting a same-family shared trunk', () => {
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
		).toBeUndefined();
		expect(
			validateSharedLaneIncidentPath(geometry, contract, path, [
				{ ...path, relationId: 'previous', endpointId: 'other' },
			]),
		).toMatchObject({ code: RegionIncidentRejectionCode.RouteObstructed });
		// Only the assembled relation can carry a bridge eight units from the leaf portal.
		expect(path.points).toEqual([path.anchor, path.portal]);
		const crossing = {
			id: 'near-portal',
			from: 'foreign-a',
			to: 'foreign-b',
			points: [
				{ x: path.portal.x + 8, y: path.anchor.y - 5 },
				{ x: path.portal.x + 8, y: path.anchor.y + 5 },
			],
		};
		expect(path.anchor.x).toBeGreaterThan(defined(crossing.points[0]).x);
		expect(validatedBridges([crossing, { id: path.relationId, points: path.points }])).toEqual([]);
		expect(
			validateSharedLaneIncidentPath({ ...geometry, relations: [crossing] }, contract, path),
		).toBeUndefined();
		expect(
			validatedBridges([
				crossing,
				{
					id: path.relationId,
					points: [path.anchor, path.portal, { x: path.portal.x - 32, y: path.anchor.y }],
				},
			]),
		).toHaveLength(1);
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
					allowedSides: [
						RegionPortalSide.Right,
						RegionPortalSide.Left,
						RegionPortalSide.Top,
						RegionPortalSide.Bottom,
					],
				},
			],
		});
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		expect(selected.incidents[0]?.side).toBe(RegionPortalSide.Right);
		expect(selected.incidents[0]?.points).toHaveLength(4);
		expect(selected.witness.attempted).toBe(6);
		expect(selected.witness.rejectedAlternatives).toHaveLength(3);
		expect(selected.allocationWitness?.passes[0]?.attempted).toBe(3);
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
		expect(result.witness.attempted).toBeGreaterThan(0);
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

	it('keeps a valid bridge-free route ahead of a shorter bridged candidate', () => {
		const base = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'a1-b1', from: 'a1', to: 'b1' },
			{ id: 'a1-c1', from: 'a1', to: 'c1' },
			{ id: 'a1-c2', from: 'a1', to: 'c2' },
		]);
		const b1 = defined(base.nodes.find(({ id }) => id === 'b1'));
		const c1 = defined(base.nodes.find(({ id }) => id === 'c1'));
		const document: LogicDocument = {
			...base,
			nodes: [
				...base.nodes.filter(({ id }) => id !== 'c1'),
				{ ...b1, id: 'b2', markdown: 'B2', layoutOrder: orderKey('a3') },
				{ ...c1, layoutOrder: orderKey('a4') },
				{ ...c1, id: 'c2', markdown: 'C2', layoutOrder: orderKey('a5') },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const ports = planSharedLanePorts(input);
		const plans = parallelStrategyPlans(input, ports, []);
		const bridged = [...parallelRouteCandidates(input, plans, false)]
			.map((candidate) =>
				materializeParallelGeometry(input, candidate.frame, candidate.order, candidate.allocation),
			)
			.filter(
				(geometry) =>
					validatedBridges(geometry.relations).length > 0 &&
					validateSharedLaneGeometry(prepared.graph, geometry, SHARED_LANE_CLEARANCE, true) ===
						undefined,
			)
			.sort((left, right) => {
				const leftMetrics = laneRouteMetrics(left);
				const rightMetrics = laneRouteMetrics(right);
				return (
					leftMetrics.bridges - rightMetrics.bridges ||
					leftMetrics.length - rightMetrics.length ||
					leftMetrics.bends - rightMetrics.bends
				);
			});
		const shortestBridged = defined(bridged[0]);
		const shortestBridgedMetrics = laneRouteMetrics(shortestBridged);
		expect(
			validateSharedLaneGeometry(prepared.graph, shortestBridged, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();

		const selected = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(selected.status).toBe(SharedLaneLayoutStatus.Selected);
		if (selected.status !== SharedLaneLayoutStatus.Selected) return;
		const selectedMetrics = laneRouteMetrics(selected.geometry);
		expect(validateSharedLaneGeometry(prepared.graph, selected.geometry)).toBeUndefined();
		expect(selectedMetrics.bridges).toBe(0);
		expect(shortestBridgedMetrics.bridges).toBeGreaterThan(0);
		expect(shortestBridgedMetrics.length).toBeLessThan(selectedMetrics.length);
	});

	it('matches delta-routed candidates against full materialization and validation under ID permutations', () => {
		const idOrders = [
			['within-a', 'a1-to-b', 'a2-to-b'],
			['within-a', 'a2-to-b', 'a1-to-b'],
			['a1-to-b', 'within-a', 'a2-to-b'],
			['a1-to-b', 'a2-to-b', 'within-a'],
			['a2-to-b', 'within-a', 'a1-to-b'],
			['a2-to-b', 'a1-to-b', 'within-a'],
		] as const;
		const endpoints = [
			{ from: 'a1', to: 'a2' },
			{ from: 'a1', to: 'b1' },
			{ from: 'a2', to: 'b1' },
		] as const;
		for (const ids of idOrders) {
			const relations = endpoints.map((relation, index) => ({
				...relation,
				id: defined(ids[index]),
			}));
			const prepared = prepareLayoutDocument(
				laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, relations),
			);
			const input = defined(
				prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
			);
			const ports = planSharedLanePorts(input);
			const plans = parallelStrategyPlans(input, ports, []);
			for (const acceptBridges of [false, true]) {
				const candidates = [...parallelRouteCandidates(input, plans, acceptBridges)];
				expect(candidates).toHaveLength(18);
				const canonical = defined(candidates[0]);
				const local = defined(candidates[1]);
				const canonicalGeometry = materializeParallelGeometry(
					input,
					canonical.frame,
					canonical.order,
					canonical.allocation,
				);
				const differentFrame = materializeParallelGeometryDelta(
					input,
					local,
					canonical,
					canonicalGeometry,
				);
				const fullLocal = materializeParallelGeometry(
					input,
					local.frame,
					local.order,
					local.allocation,
				);
				expect(differentFrame.geometry).toEqual(fullLocal);
				expect(differentFrame.changedRouteIds).toEqual(new Set(input.plans.map(({ id }) => id)));
				expect(
					validateSharedLaneGeometryDelta({
						graph: prepared.graph,
						geometry: differentFrame.geometry,
						staticCertificate: certifySharedLaneGeometry(prepared.graph, canonicalGeometry),
						routeCertificate: certifySharedLaneRouteGeometry(prepared.graph, canonicalGeometry),
						changedRouteIds: differentFrame.changedRouteIds,
						acceptBridges,
					}),
				).toBe(
					validateSharedLaneGeometry(
						prepared.graph,
						fullLocal,
						SHARED_LANE_CLEARANCE,
						acceptBridges,
					),
				);
				for (const candidate of candidates) {
					const baselineCandidate = defined(
						candidates.find(
							({ frame, historicalRank, strategyRank }) =>
								frame === candidate.frame &&
								historicalRank !== undefined &&
								strategyRank === candidate.strategyRank,
						),
					);
					const baseline = materializeParallelGeometry(
						input,
						baselineCandidate.frame,
						baselineCandidate.order,
						baselineCandidate.allocation,
					);
					const staticCertificate = certifySharedLaneGeometry(prepared.graph, baseline);
					const routeCertificate = certifySharedLaneRouteGeometry(
						prepared.graph,
						baseline,
						SHARED_LANE_CLEARANCE,
					);
					const delta = materializeParallelGeometryDelta(
						input,
						candidate,
						baselineCandidate,
						baseline,
					);
					const full = materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					);
					const baselineById = new Map(baseline.relations.map((route) => [route.id, route]));
					const expectedChangedIds: string[] = [];
					for (const route of full.relations) {
						const baselineRoute = defined(baselineById.get(route.id));
						const deltaRoute = defined(delta.geometry.relations.find(({ id }) => id === route.id));
						expect(deltaRoute.points).toEqual(route.points);
						const changed =
							route.points.length !== baselineRoute.points.length ||
							route.points.some((point, index) => {
								const originalPoint = defined(baselineRoute.points[index]);
								return point.x !== originalPoint.x || point.y !== originalPoint.y;
							});
						if (changed) {
							expectedChangedIds.push(route.id);
							expect(deltaRoute).not.toBe(baselineRoute);
						} else expect(deltaRoute).toBe(baselineRoute);
					}
					expect([...delta.changedRouteIds].sort()).toEqual(expectedChangedIds.sort());
					const issue = validateSharedLaneGeometry(
						prepared.graph,
						full,
						SHARED_LANE_CLEARANCE,
						acceptBridges,
					);
					const deltaValidation = validateSharedLaneGeometryDelta({
						graph: prepared.graph,
						geometry: delta.geometry,
						staticCertificate,
						routeCertificate,
						changedRouteIds: delta.changedRouteIds,
						acceptBridges,
						clearance: SHARED_LANE_CLEARANCE,
					});
					expect(deltaValidation).toBe(issue);
					if (issue !== undefined) continue;

					const deltaScore = rankLaneRouteSelection(
						{
							geometry: delta.geometry,
							incidents: [],
						},
						candidate,
					);
					const fullScore = rankLaneRouteSelection({ geometry: full, incidents: [] }, candidate);
					expect([deltaScore.bridges, deltaScore.length, deltaScore.bends]).toEqual([
						fullScore.bridges,
						fullScore.length,
						fullScore.bends,
					]);
				}
			}
		}
	});

	it('revalidates malformed historical routes and rejects changed route segments independently', () => {
		const prepared = prepareLayoutDocument(
			laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
				{ id: 'within-a', from: 'a1', to: 'a2' },
				{ id: 'a1-to-b', from: 'a1', to: 'b1' },
				{ id: 'a2-to-b', from: 'a2', to: 'b1' },
			]),
		);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const candidates = [
			...parallelRouteCandidates(
				input,
				parallelStrategyPlans(input, planSharedLanePorts(input), []),
				false,
			),
		];
		const baseline = defined(candidates[0]);
		const alternative = defined(
			candidates.find(
				(candidate) => candidate.order === baseline.order && candidate.historicalRank === undefined,
			),
		);
		const original = materializeParallelGeometry(
			input,
			baseline.frame,
			baseline.order,
			baseline.allocation,
		);
		const delta = materializeParallelGeometryDelta(input, alternative, baseline, original);
		const staticCertificate = certifySharedLaneGeometry(prepared.graph, original);
		const routeCertificate = certifySharedLaneRouteGeometry(prepared.graph, original);
		const staticFailure = { ...delta.geometry, width: -1 };
		expect(
			validateSharedLaneGeometryDelta({
				graph: prepared.graph,
				geometry: staticFailure,
				staticCertificate,
				routeCertificate,
				changedRouteIds: delta.changedRouteIds,
				acceptBridges: false,
			}),
		).toBe(validateSharedLaneGeometry(prepared.graph, staticFailure));
		const changedId = defined([...delta.changedRouteIds][0]);
		const malformedRoute = {
			...delta.geometry,
			relations: delta.geometry.relations.map((route) => {
				if (route.id !== changedId) return route;
				return {
					...route,
					points: route.points.map((point, index) => {
						if (index === 2) return defined(route.points[1]);
						return point;
					}),
				};
			}),
		};
		expect(
			validateSharedLaneGeometryDelta({
				graph: prepared.graph,
				geometry: malformedRoute,
				staticCertificate,
				routeCertificate,
				changedRouteIds: delta.changedRouteIds,
				acceptBridges: false,
			}),
		).toBe(validateSharedLaneGeometry(prepared.graph, malformedRoute));
		const historicalRoute = defined(original.relations[0]);
		const malformedHistorical = {
			...original,
			relations: [
				{
					...historicalRoute,
					points: historicalRoute.points.map((point, index) => {
						if (index === 2) return defined(historicalRoute.points[1]);
						return point;
					}),
				},
				...original.relations.slice(1),
			],
		};
		const invalidCertificate = certifySharedLaneRouteGeometry(prepared.graph, malformedHistorical);
		expect(invalidCertificate.issue).toBeDefined();
		expect(
			validateSharedLaneGeometryDelta({
				graph: prepared.graph,
				geometry: delta.geometry,
				staticCertificate,
				routeCertificate: invalidCertificate,
				changedRouteIds: delta.changedRouteIds,
				acceptBridges: false,
			}),
		).toBe(validateSharedLaneGeometry(prepared.graph, delta.geometry));
	});

	it.each([
		[RegionPortalSide.Right, false],
		[RegionPortalSide.Left, true],
	])(
		'compares incident-bearing three-route geometries with an exhaustive allocation oracle (%s)',
		(side, requiresBridges) => {
			const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
				{ id: 'within-a', from: 'a1', to: 'a2' },
				{ id: 'a1-to-b', from: 'a1', to: 'b1' },
				{ id: 'a2-to-b', from: 'a2', to: 'b1' },
			]);
			const prepared = prepareLayoutDocument(document);
			const routing = prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {});
			const input = defined(routing.input);
			const contracts = [
				{
					relation: { id: 'outer-a1', from: 'a1', to: 'outside' },
					endpointId: 'a1',
					role: RegionIncidentRole.Source,
					allowedSides: [side],
				},
			];
			const ports = planSharedLanePorts(input, contracts);
			const plans = parallelStrategyPlans(input, ports, contracts);
			const exhaustiveCandidateTotal = [...parallelRouteCandidates(input, plans, false)].length;
			let exhaustiveBest: ReturnType<typeof rankLaneRouteSelection> | undefined;
			for (const acceptBridges of [false, true]) {
				const exhaustiveCandidates = [...parallelRouteCandidates(input, plans, acceptBridges)];
				const oracleState = {
					attempted: 0,
					exhaustive: true,
					strategyId: '',
					candidateId: '',
					rejectedAlternatives: [],
				};
				for (const candidate of exhaustiveCandidates) {
					const geometry = materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					);
					if (
						validateSharedLaneGeometry(
							prepared.graph,
							geometry,
							SHARED_LANE_CLEARANCE,
							acceptBridges,
						) !== undefined
					)
						continue;
					oracleState.strategyId = candidate.strategyId;
					oracleState.candidateId = candidate.candidateId;
					const incidents = searchLaneIncidentPaths({
						geometry,
						ports,
						contracts,
						state: oracleState,
					});
					if (incidents === undefined) continue;
					const ranked = rankLaneRouteSelection(
						{ geometry, incidents, id: candidate.candidateId },
						candidate,
					);
					if (exhaustiveBest === undefined || laneRouteSelectionIsBetter(ranked, exhaustiveBest))
						exhaustiveBest = ranked;
				}
				if (exhaustiveBest !== undefined) break;
			}
			expect(exhaustiveBest).toBeDefined();
			const searchState = {
				attempted: 0,
				exhaustive: true,
				strategyId: '',
				candidateId: '',
				rejectedAlternatives: [],
			};
			const result = searchParallelRouteAllocations({
				input,
				ports,
				contracts,
				state: searchState,
				evaluate: (candidate, acceptBridges) => {
					const geometry = materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					);
					if (
						validateSharedLaneGeometry(
							prepared.graph,
							geometry,
							SHARED_LANE_CLEARANCE,
							acceptBridges,
						) !== undefined
					)
						return undefined;
					const incidents = searchLaneIncidentPaths({
						geometry,
						ports,
						contracts,
						state: searchState,
					});
					if (incidents === undefined) return undefined;
					return { geometry, incidents, id: candidate.candidateId };
				},
			});
			const pass = defined(result.allocationWitness.passes[0]);
			expect(pass).toMatchObject({
				acceptBridges: false,
				attempted: exhaustiveCandidateTotal,
				searchStarted: true,
			});
			const production = solveSharedLaneLayout(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
				{
					incidents: contracts,
				},
			);
			expect(production.status).toBe(SharedLaneLayoutStatus.Selected);
			if (production.status !== SharedLaneLayoutStatus.Selected) return;

			expect(production.geometry).toEqual(exhaustiveBest?.selected.geometry);
			expect(production.incidents).toEqual(exhaustiveBest?.selected.incidents);
			expect(production.allocationWitness?.passes.at(-1)?.acceptBridges).toBe(requiresBridges);
			expect(result.selected?.geometry).toEqual(exhaustiveBest?.selected.geometry);
			expect(result.selected?.incidents).toEqual(exhaustiveBest?.selected.incidents);
			expect(result.selected?.id).toBe(exhaustiveBest?.candidate.candidateId);
			if (result.selected !== undefined && exhaustiveBest !== undefined) {
				const score = rankLaneRouteSelection(result.selected, exhaustiveBest.candidate);
				expect({ bridges: score.bridges, length: score.length, bends: score.bends }).toEqual({
					bridges: exhaustiveBest.bridges,
					length: exhaustiveBest.length,
					bends: exhaustiveBest.bends,
				});
			}
			const noIncidentState = {
				attempted: 0,
				exhaustive: true,
				strategyId: '',
				candidateId: '',
				rejectedAlternatives: [],
			};
			const noIncidentResult = searchParallelRouteAllocations({
				input,
				ports,
				contracts: [],
				state: noIncidentState,
				evaluate: (candidate, acceptBridges) => {
					const geometry = materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					);
					if (
						validateSharedLaneGeometry(
							prepared.graph,
							geometry,
							SHARED_LANE_CLEARANCE,
							acceptBridges,
						) !== undefined
					)
						return undefined;
					return { geometry, incidents: [] };
				},
			});
			expect(noIncidentResult.selected).toBeDefined();
		},
	);

	it('selects a three-dependency crossing through validated bridges in the second pass', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'within-a', from: 'a1', to: 'a2' },
			{ id: 'a1-to-b', from: 'a1', to: 'b1' },
			{ id: 'a2-to-b', from: 'a2', to: 'b1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const baseline = parallelCandidate(document, ParallelRouteOrder.Canonical);
		const baselineMetrics = laneRouteMetrics(baseline.geometry);
		expect(
			validateSharedLaneGeometry(baseline.graph, baseline.geometry, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();
		expect(baselineMetrics).toEqual({ bridges: 3, length: 2488, bends: 10 });
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
		expect(result.allocationWitness?.passes).toMatchObject([
			{
				acceptBridges: false,
				attempted: 18,
				total: '18',
				exhaustive: true,
				truncated: false,
				searchStarted: true,
			},
			{
				acceptBridges: true,
				attempted: 18,
				total: '18',
				exhaustive: true,
				truncated: false,
				searchStarted: true,
			},
		]);
		const bridges = validatedBridges(result.geometry.relations);
		expect(bridges).toHaveLength(1);
		const metrics = laneRouteMetrics(result.geometry);
		expect(metrics.bridges).toBeLessThan(baselineMetrics.bridges);
		expect(metrics.length).toBeLessThan(baselineMetrics.length);
		expect(metrics.length).toBeLessThanOrEqual(2392);
		expect(metrics.bends).toBeLessThanOrEqual(10);
		expect(solve({ ...document, relations: [...document.relations].reverse() })).toEqual(result);
		for (const [index, route] of result.geometry.relations.entries())
			for (const other of result.geometry.relations.slice(index + 1))
				expect(unbridgedContacts(route, other, bridges)).toEqual([]);
	});

	it('reaches a valid LocalPassages permutation after the first 64 canonical alternatives', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'r1', from: 'a1', to: 'a2' },
			{ id: 'r0', from: 'a1', to: 'b1' },
			{ id: 'r2', from: 'a2', to: 'c1' },
			{ id: 'r3', from: 'b1', to: 'c1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const ports = planSharedLanePorts(input);
		const candidates = [
			...parallelRouteCandidates(input, parallelStrategyPlans(input, ports, []), false),
		];
		const canonical = candidates.filter(({ order }) => order === ParallelRouteOrder.Canonical);
		expect(canonical.length).toBeGreaterThan(64);
		for (const candidate of canonical.slice(0, 64)) {
			const geometry = materializeParallelGeometry(
				input,
				candidate.frame,
				candidate.order,
				candidate.allocation,
			);
			expect(validateSharedLaneGeometry(prepared.graph, geometry)).toBeDefined();
		}
		const local = candidates.filter(({ order }) => order === ParallelRouteOrder.LocalPassages);
		const firstLocal = defined(local[0]);
		expect(
			validateSharedLaneGeometry(
				prepared.graph,
				materializeParallelGeometry(
					input,
					firstLocal.frame,
					firstLocal.order,
					firstLocal.allocation,
				),
			),
		).toBeDefined();
		const validLocal = local.find(
			(candidate) =>
				validateSharedLaneGeometry(
					prepared.graph,
					materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					),
				) === undefined,
		);
		expect(validLocal).toBeDefined();
		expect(defined(validLocal).historicalRank).toBeUndefined();
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
		expect(validatedBridges(result.geometry.relations)).toHaveLength(0);
		const localGeometries = local
			.map((candidate) =>
				materializeParallelGeometry(input, candidate.frame, candidate.order, candidate.allocation),
			)
			.filter((geometry) => validateSharedLaneGeometry(prepared.graph, geometry) === undefined);
		expect(localGeometries).toContainEqual(result.geometry);
		expect(result.allocationWitness?.passes[0]).toMatchObject({
			acceptBridges: false,
			total: String(candidates.length),
			truncated: true,
		});
	});

	it('bounds measured alternatives independently of reserved baseline work', () => {
		const document = fourRouteCrossingDocument();
		const prepared = prepareLayoutDocument(document);
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
		const baseline = parallelCandidate(document, ParallelRouteOrder.Canonical);
		expect(
			validateSharedLaneGeometry(baseline.graph, baseline.geometry, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();
		expect(laneRouteMetrics(baseline.geometry).bridges).toBeGreaterThan(0);
		expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
		if (result.status !== SharedLaneLayoutStatus.Selected) return;
		const passes = defined(result.allocationWitness).passes;
		expect(passes.map(({ acceptBridges }) => acceptBridges)).toEqual([false, true]);
		for (const pass of passes) {
			expect(pass.attempted).toBeGreaterThan(2); // Both strategy baselines were evaluated.
			expect(pass.attempted).toBeLessThan(Number(pass.total));
			expect(pass.exhaustive).toBe(false);
			expect(pass.truncated).toBe(true);
			expect(pass.searchStarted).toBe(true);
			expect(pass.baselineWork).toBeGreaterThan(0);
			expect(pass.work).toBeGreaterThan(0);
			expect(pass.work).toBeLessThanOrEqual(pass.workBudget);
			expect(pass.workBudget).toBe(20_000);
		}
		expect(
			validateSharedLaneGeometry(prepared.graph, result.geometry, SHARED_LANE_CLEARANCE, true),
		).toBeUndefined();
		expect(validatedBridges(result.geometry.relations).length).toBeGreaterThan(0);
	});

	it('keeps geometry rejections outside the bounded incident choice count', () => {
		const document = fourRouteCrossingDocument();
		const prepared = prepareLayoutDocument(document);
		const incidents = Array.from({ length: 257 }, (_, index) => ({
			relation: { id: `outer-${index}`, from: 'a1', to: `external-${index}` },
			endpointId: 'a1',
			role: RegionIncidentRole.Source,
			allowedSides: [RegionPortalSide.Right],
		}));
		const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements, {
			incidents,
		});
		expect(result.status).toBe(SharedLaneLayoutStatus.Unknown);
		if (result.status !== SharedLaneLayoutStatus.Unknown) return;
		expect(result.code).toBe(RegionIncidentUnknownCode.SearchBudgetExceeded);
		expect(result.witness.attempted).toBeGreaterThan(0);
		expect(result.witness.attempted).toBeLessThanOrEqual(256);
		expect(result.witness.rejectedAlternatives).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: RegionIncidentRejectionCode.GeometryInvalid }),
			]),
		);
		expect(result.allocationWitness?.passes).toEqual([
			expect.objectContaining({
				acceptBridges: false,
				exhaustive: false,
				truncated: true,
			}),
			expect.objectContaining({
				acceptBridges: true,
				exhaustive: false,
				truncated: true,
			}),
		]);
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

	it('checks static certificate mismatches after a route-track variant', () => {
		const document = fourRouteCrossingDocument();
		const prepared = prepareLayoutDocument(document);
		const routing = prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {});
		const input = defined(routing.input);
		const ports = planSharedLanePorts(input);
		const plans = parallelStrategyPlans(input, ports, []);
		const candidates = [...parallelRouteCandidates(input, plans, false)];
		const baseline = defined(candidates[0]);
		const baselineGeometry = materializeParallelGeometry(
			input,
			baseline.frame,
			baseline.order,
			baseline.allocation,
		);
		const certificate = certifySharedLaneGeometry(prepared.graph, baselineGeometry);
		const variant = defined(
			candidates.find(
				({ frame, allocationKey }) =>
					frame === baseline.frame && allocationKey !== baseline.allocationKey,
			),
		);
		const geometry = materializeParallelGeometry(
			input,
			variant.frame,
			variant.order,
			variant.allocation,
		);
		const first = defined(geometry.elements[0]);
		const second = defined(geometry.elements[1]);
		const overlapping = {
			...geometry,
			elements: [first, { ...second, bounds: first.bounds }, ...geometry.elements.slice(2)],
		};
		expect(
			validateSharedLaneGeometryWithCertificate(prepared.graph, overlapping, certificate, true),
		).toContain('overlap');
	});

	it('shares a static certificate across route variants and rejects a corrupted route', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'within-a', from: 'a1', to: 'a2' },
			{ id: 'a1-to-b', from: 'a1', to: 'b1' },
			{ id: 'a2-to-b', from: 'a2', to: 'b1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const routing = prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {});
		const input = defined(routing.input);
		const ports = planSharedLanePorts(input);
		const plans = parallelStrategyPlans(input, ports, []);
		const candidates = [...parallelRouteCandidates(input, plans, false)];
		const baseline = defined(candidates[0]);
		const baselineGeometry = materializeParallelGeometry(
			input,
			baseline.frame,
			baseline.order,
			baseline.allocation,
		);
		const certificate = certifySharedLaneGeometry(prepared.graph, baselineGeometry);
		const variant = candidates.find(
			(candidate) =>
				candidate.frame === baseline.frame &&
				candidate.allocationKey !== baseline.allocationKey &&
				validateSharedLaneGeometry(
					prepared.graph,
					materializeParallelGeometry(
						input,
						candidate.frame,
						candidate.order,
						candidate.allocation,
					),
					SHARED_LANE_CLEARANCE,
					true,
				) === undefined,
		);
		expect(variant).toBeDefined();
		if (variant === undefined) return;
		const geometry = materializeParallelGeometry(
			input,
			variant.frame,
			variant.order,
			variant.allocation,
		);
		expect(geometry.elements).toBe(baselineGeometry.elements);
		expect(geometry.lanes).toBe(baselineGeometry.lanes);
		expect(
			validateSharedLaneGeometryWithCertificate(prepared.graph, geometry, certificate, true),
		).toBeUndefined();
		const corrupted = {
			...geometry,
			relations: geometry.relations.map((route, index) => {
				if (index !== 0) return route;
				const start = defined(route.points[0]);
				return {
					...route,
					points: [{ ...start, x: start.x + 1 }, ...route.points.slice(1)],
				};
			}),
		};
		expect(
			validateSharedLaneGeometryWithCertificate(prepared.graph, corrupted, certificate, true),
		).toContain('wrong source face');
	});

	it.each([
		[LayoutDirection.TopToBottom, LayoutBias.Top, true],
		[LayoutDirection.RightToLeft, LayoutBias.Right, false],
	])(
		'finds the earliest canonical overlap through the spatial index in %s',
		(direction, bias, vertical) => {
			const base = laneDocument(direction, bias, [], 2);
			const template = defined(base.nodes.find(({ id }) => id === 'a1'));
			const additions = Array.from({ length: 14 }, (_, index) => ({
				...template,
				id: `extra-${index.toString().padStart(2, '0')}`,
				markdown: `Extra ${index}`,
				layoutOrder: orderKey('a0'),
			}));
			const document = { ...base, nodes: [...base.nodes, ...additions] };
			const prepared = prepareLayoutDocument(document);
			const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
			expect(result.status).toBe(SharedLaneLayoutStatus.Selected);
			if (result.status !== SharedLaneLayoutStatus.Selected) return;
			const laneNodeIds = new Set(
				document.nodes.filter(({ laneId }) => laneId === 'A').map(({ id }) => id),
			);
			const laneBoxes = result.geometry.elements.filter(({ id }) => laneNodeIds.has(id));
			const first = defined(laneBoxes[0]);
			const second = defined(laneBoxes[1]);
			const third = defined(laneBoxes[2]);
			const lane = defined(result.geometry.lanes.find(({ id }) => id === 'A'));
			let centerCross = lane.bounds.x + lane.bounds.width / 2;
			let centerLong = lane.bounds.y + lane.bounds.height / 2;
			if (!vertical) {
				centerCross = lane.bounds.y + lane.bounds.height / 2;
				centerLong = lane.bounds.x + lane.bounds.width / 2;
			}
			const positioned = (element: (typeof laneBoxes)[number], longStart: number) => {
				let crossStart = centerCross - element.bounds.width / 2;
				let x = crossStart;
				let y = longStart;
				if (!vertical) {
					crossStart = centerCross - element.bounds.height / 2;
					x = longStart;
					y = crossStart;
				}
				return { ...element, bounds: { ...element.bounds, x, y } };
			};
			let firstLength = first.bounds.height;
			if (!vertical) firstLength = first.bounds.width;
			const overlapping = {
				...result.geometry,
				elements: result.geometry.elements.map((element) => {
					if (element.id === first.id) return positioned(element, centerLong - firstLength / 2);
					if (element.id === second.id) return positioned(element, centerLong + firstLength / 4);
					if (element.id === third.id)
						return positioned(element, centerLong - (firstLength * 3) / 4);
					return element;
				}),
			};
			const sorted = [...overlapping.elements].sort((left, right) => {
				if (left.id < right.id) return -1;
				if (left.id > right.id) return 1;
				return 0;
			});
			let expected: string | undefined;
			for (let left = 0; left < sorted.length && expected === undefined; left += 1) {
				const a = defined(sorted[left]);
				for (let right = left + 1; right < sorted.length; right += 1) {
					const b = defined(sorted[right]);
					if (
						a.bounds.x < b.bounds.x + b.bounds.width &&
						a.bounds.x + a.bounds.width > b.bounds.x &&
						a.bounds.y < b.bounds.y + b.bounds.height &&
						a.bounds.y + a.bounds.height > b.bounds.y
					) {
						expected = `Elements ${a.id} and ${b.id} overlap.`;
						break;
					}
				}
			}
			expect(certifySharedLaneGeometry(prepared.graph, overlapping).issue).toBe(expected);
		},
	);

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
	it('prefers fewer bends at equal validated bridge and length cost', () => {
		const document = laneDocument(
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
			[{ id: 'a-to-b', from: 'a1', to: 'b1' }],
			2,
		);
		const original = parallelCandidate(document, ParallelRouteOrder.LocalPassages);
		const route = defined(original.geometry.relations[0]);
		const points = route.points;
		const firstGutter = defined(points[1]);
		const secondGutter = defined(points[3]);
		const middleY = (firstGutter.y + secondGutter.y) / 2;
		const middleX = (firstGutter.x + secondGutter.x) / 2;
		const bent = {
			...original.geometry,
			relations: [
				{
					...route,
					points: [
						defined(points[0]),
						firstGutter,
						{ x: firstGutter.x, y: middleY },
						{ x: middleX, y: middleY },
						{ x: middleX, y: secondGutter.y },
						...points.slice(3),
					],
				},
			],
		};
		expect(validateSharedLaneGeometry(original.graph, original.geometry)).toBeUndefined();
		expect(validateSharedLaneGeometry(original.graph, bent)).toBeUndefined();
		const identity = {
			historicalRank: undefined,
			allocationKey: 'gutter',
			strategyId: 'parallel/local-passages',
			candidateId: 'natural',
		};
		const shorter = rankLaneRouteSelection(
			{ geometry: original.geometry, incidents: [] },
			identity,
		);
		const moreBends = rankLaneRouteSelection(
			{ geometry: bent, incidents: [] },
			{ ...identity, candidateId: 'bent' },
		);
		expect([shorter.bridges, shorter.length]).toEqual([moreBends.bridges, moreBends.length]);
		expect(shorter.bends).toBeLessThan(moreBends.bends);
		expect(laneRouteSelectionIsBetter(shorter, moreBends)).toBe(true);
		expect(laneRouteSelectionIsBetter(moreBends, shorter)).toBe(false);
	});

	it('prefers historical routes then canonical allocation IDs at equal geometric score', () => {
		const document = laneDocument(LayoutDirection.TopToBottom, LayoutBias.Top, [
			{ id: 'r1', from: 'a1', to: 'a2' },
			{ id: 'r0', from: 'a1', to: 'b1' },
			{ id: 'r2', from: 'a2', to: 'c1' },
			{ id: 'r3', from: 'b1', to: 'c1' },
		]);
		const prepared = prepareLayoutDocument(document);
		const input = defined(
			prepareSharedLanes(prepared.graph, prepared.ranks, prepared.measurements, {}).input,
		);
		const candidates = [
			...parallelRouteCandidates(
				input,
				parallelStrategyPlans(input, planSharedLanePorts(input), []),
				true,
			),
		];
		const ranked = candidates.map((candidate) => {
			const geometry = materializeParallelGeometry(
				input,
				candidate.frame,
				candidate.order,
				candidate.allocation,
			);
			if (
				validateSharedLaneGeometry(prepared.graph, geometry, SHARED_LANE_CLEARANCE, true) !==
				undefined
			)
				return undefined;
			return rankLaneRouteSelection({ geometry, incidents: [] }, candidate);
		});
		const historical = defined(ranked[0]);
		const metricMatch = (candidate: NonNullable<(typeof ranked)[number]>) =>
			candidate.bridges === historical.bridges &&
			candidate.length === historical.length &&
			candidate.bends === historical.bends;
		const later = defined(
			ranked.find(
				(candidate) =>
					candidate !== undefined &&
					candidate.candidate.historicalRank === undefined &&
					metricMatch(candidate),
			),
		);
		expect(laneRouteSelectionIsBetter(historical, later)).toBe(true);
		expect(laneRouteSelectionIsBetter(later, historical)).toBe(false);
		const sameCost = ranked
			.filter((candidate) => candidate !== undefined)
			.filter(
				(candidate) => candidate.candidate.historicalRank === undefined && metricMatch(candidate),
			);
		const [first, second] = sameCost.filter(
			(candidate) => candidate.candidate.strategyId === later.candidate.strategyId,
		);
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		const firstBetter = laneRouteSelectionIsBetter(defined(first), defined(second));
		const secondBetter = laneRouteSelectionIsBetter(defined(second), defined(first));
		expect(firstBetter).toBe(
			compareCanonicalStrings(
				defined(first).candidate.allocationKey,
				defined(second).candidate.allocationKey,
			) < 0,
		);
		expect(secondBetter).toBe(!firstBetter);
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
