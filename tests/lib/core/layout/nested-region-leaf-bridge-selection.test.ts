import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LayoutPolicy } from '../../../../src/lib/core/document/logic-document';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { layoutRouteCost } from '../../../../src/lib/core/layout/geometry/layout-route-cost';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import { enumerateSharedLaneLayouts } from '../../../../src/lib/core/layout/lanes/shared-lane-candidate-enumeration';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import {
	leafDocument,
	leafIncidentContracts,
} from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-model-adapter';
import { solveDedicatedRegionLeafWithIncidents } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-solver';
import {
	enumerateRegionLeafLayoutsWithIncidents,
	solveRegionLeafLayoutWithIncidents,
} from '../../../../src/lib/core/layout/regions/leaf/region-leaf-layout';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { nestedRegionLocalMeasurements } from '../../../../src/lib/core/layout/regions/recursive/nested-region-local-measurements';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { persistedComposedLeafBridgeDocument } from './nested-region-fixture';

const document = persistedComposedLeafBridgeDocument();
const graph = createGraph(document);
if (!graph.ok) throw new Error(graph.diagnostics.map(({ message }) => message).join('; '));
const preparedGraph = graph.value;
const input = nestedRegionInput(preparedGraph);
const model = normalizeRegionCompositionModel(preparedGraph, input);
if (model.status !== RegionCompositionModelStatus.Ready) throw new Error(model.diagnostic.message);
const measurements = {
	nodes: new Map(document.nodes.map(({ id }) => [id, { width: 60, height: 64 }])),
	groups: new Map(),
	junctions: new Map(),
};

function solve(): RegionLayoutSelected {
	const attempt = solveRecursiveNestedRegionLayout(preparedGraph, measurements, input);
	if (attempt.status !== RegionCompositionStatus.Selected) throw new Error(attempt.reason);
	return attempt;
}

/** Replace only the declared lane rail and the common-ancestor bus endpoint, retaining all other pieces. */
function onLaneRail(selected: RegionLayoutSelected, rail: number): RegionLayoutSelected {
	const lane = selected.regions.find(({ id }) => id === 'lane');
	const source = selected.ownedRoutes.find(
		({ relationId, regionId }) => relationId === 'cross' && regionId === 'lane',
	);
	const bus = selected.ownedRoutes.find(
		({ relationId, regionId }) => relationId === 'cross' && regionId === '@root',
	);
	const target = selected.ownedRoutes.find(
		({ relationId, regionId }) => relationId === 'cross' && regionId === 'ordinary',
	);
	if (lane === undefined || source === undefined || bus === undefined || target === undefined)
		throw new Error('The composed crossing has no complete owned route.');
	const anchor = source.points[0];
	const busTop = bus.points[1];
	const foreignPortal = bus.points.at(-1);
	if (anchor === undefined || busTop === undefined || foreignPortal === undefined)
		throw new Error('The composed crossing has no endpoints.');
	const sourcePortal = { x: rail, y: lane.bounds.y };
	const sourcePoints: Point[] = [
		anchor,
		{ x: anchor.x, y: anchor.y - 12 },
		{ x: rail, y: anchor.y - 12 },
		sourcePortal,
	];
	const busPoints: Point[] = [
		sourcePortal,
		{ x: rail, y: busTop.y },
		{ x: foreignPortal.x, y: busTop.y },
		foreignPortal,
	];
	const points = [...sourcePoints, ...busPoints.slice(1), ...target.points.slice(1)];
	return {
		...selected,
		layout: {
			...selected.layout,
			relations: selected.layout.relations.map((relation) => {
				if (relation.id === 'cross') return { ...relation, points };
				return relation;
			}),
		},
		ownedRoutes: selected.ownedRoutes.map((piece) => {
			if (piece.relationId !== 'cross') return piece;
			if (piece.regionId === 'lane') return { ...piece, points: sourcePoints };
			if (piece.regionId === '@root') return { ...piece, points: busPoints };
			return piece;
		}),
		portals: selected.portals.map((portal) => {
			if (portal.relationId !== 'cross' || portal.regionId !== 'lane') return portal;
			return {
				...portal,
				point: { x: rail, y: portal.point.y },
				localPoint: { x: rail - lane.bounds.x, y: portal.localPoint.y },
			};
		}),
	};
}

function alternatives(): {
	bridged: RegionLayoutSelected;
	unbridged: RegionLayoutSelected;
	selected: RegionLayoutSelected;
} {
	const selected = solve();
	const lane = selected.regions.find(({ id }) => id === 'lane');
	const a = selected.layout.elements.find(({ id }) => id === 'a');
	if (lane === undefined || a === undefined) throw new Error('Missing measured lane geometry.');
	// Both rails are among the existing lane candidate coordinates: one clearance beside each side of a.
	return {
		selected,
		bridged: onLaneRail(selected, a.bounds.x - 12),
		unbridged: onLaneRail(selected, a.bounds.x + a.bounds.width + 12),
	};
}

describe('persisted composed incident bridge selection', () => {
	it('holds two complete and independently valid candidates, with a cheaper route without a bridge', () => {
		const { bridged, unbridged } = alternatives();
		expect(bridged.layout.lanes).toHaveLength(2);
		expect(bridged.regions.map(({ id }) => id)).toEqual(['lane', 'ordinary']);
		for (const candidate of [bridged, unbridged]) {
			expect(validateRegionCompositionGeometry(model.model, candidate)).toBeUndefined();
			expect(validateNestedRegionLeafIncidents(model.model, candidate)).toBeUndefined();
		}
		expect(validatedBridges(bridged.layout.relations)).toMatchObject([
			{ carrierIds: ['lane-local'], crossedIds: ['cross'] },
		]);
		expect(validatedBridges(unbridged.layout.relations)).toEqual([]);
		expect(layoutRouteCost(bridged.layout)).toEqual({
			area: 834624,
			routeLength: 1707.5,
			bends: 10,
		});
		expect(layoutRouteCost(unbridged.layout)).toEqual({
			area: 834624,
			routeLength: 1623.5,
			bends: 10,
		});
	});

	it('enumerates both leaf policies deterministically with the current selection first', () => {
		const context = {
			graph: preparedGraph,
			model: model.model,
			measurements,
			cache: undefined,
			ownershipByRelationId: new Map(
				model.model.relations.map((owned) => [owned.relation.id, owned]),
			),
		};
		const sides = new Map([['cross', [RegionPortalSide.Top]]]);
		const lane = leafDocument(context, 'lane');
		const laneGraph = createGraph(lane);
		if (!laneGraph.ok) throw new Error('Invalid lane witness graph');
		const laneMeasurements = nestedRegionLocalMeasurements(lane, measurements);
		const laneContracts = leafIncidentContracts(context, 'lane', sides);
		const laneOptions = { incidents: laneContracts };
		const originalLane = solveSharedLaneLayout(
			laneGraph.value,
			topologicallyRank(laneGraph.value),
			laneMeasurements,
			laneOptions,
		);
		expect(originalLane.status).toBe(SharedLaneLayoutStatus.Selected);
		const laneSearch = enumerateSharedLaneLayouts(
			laneGraph.value,
			topologicallyRank(laneGraph.value),
			laneMeasurements,
			laneOptions,
		);
		const firstLane = laneSearch.next();
		expect(firstLane.done).toBe(false);
		if (firstLane.done === true) throw new Error('Missing first lane candidate');
		expect(firstLane.value).toEqual(originalLane);
		const lanes = [firstLane.value];
		let laneResult = laneSearch.next();
		expect(laneResult.done).toBe(false);
		if (laneResult.done === true) throw new Error('Missing second lane candidate');
		expect(laneResult.value.witness.exhaustive).toBe(false);
		while (laneResult.done === false) {
			lanes.push(laneResult.value);
			laneResult = laneSearch.next();
		}
		if (laneResult.done !== true) throw new Error('Incomplete lane search');
		const distinctPortalXs = new Set(lanes.map(({ incidents }) => incidents[0]?.portal.x));
		const a = firstLane.value.layout.elements.find(({ id }) => id === 'a');
		if (a === undefined) throw new Error('Missing lane source');
		const noBridgeRail = a.bounds.x + a.bounds.width + 12;
		expect(distinctPortalXs.has(noBridgeRail)).toBe(true);
		expect(
			lanes.some(
				(candidate) =>
					JSON.stringify(candidate.layout.relations) ===
						JSON.stringify(firstLane.value.layout.relations) &&
					candidate.incidents[0]?.portal.x === noBridgeRail,
			),
		).toBe(true);
		expect(laneResult.value.attempted).toBeGreaterThan(0);
		expect(laneResult.value.attempted).toBeLessThanOrEqual(4 * 256);
		expect(
			laneResult.value.rejectedAlternatives.some(
				({ candidateId, relationId, reason }) =>
					candidateId === 'transverse/canonical/direct' &&
					relationId === 'cross' &&
					reason?.includes('crosses node a') === true,
			),
		).toBe(true);
		expect(
			new Set(lanes.map(({ layout, incidents }) => JSON.stringify([layout, incidents]))).size,
		).toBe(lanes.length);
		const repeat = [
			...enumerateSharedLaneLayouts(
				laneGraph.value,
				topologicallyRank(laneGraph.value),
				laneMeasurements,
				laneOptions,
			),
		];
		expect(repeat.map(({ layout, incidents }) => JSON.stringify([layout, incidents]))).toEqual(
			lanes.map(({ layout, incidents }) => JSON.stringify([layout, incidents])),
		);

		const cache = new RegionLocalLayoutCache();
		const input = {
			document: lane,
			measurements: laneMeasurements,
			leafPolicy: LayoutPolicy.SharedLanes,
			contracts: laneContracts,
			cache,
		};
		const cached = solveRegionLeafLayoutWithIncidents(input);
		const policySearch = enumerateRegionLeafLayoutsWithIncidents(input);
		expect(policySearch.next().value).toEqual(cached);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });
		expect([...policySearch].some(({ incidents }) => incidents[0]?.portal.x === noBridgeRail)).toBe(
			true,
		);
		expect(cache.stats).toMatchObject({ misses: 1, hits: 1, entries: 1 });

		const ordinary = leafDocument(context, 'ordinary');
		const ordinaryInput = {
			document: ordinary,
			measurements: nestedRegionLocalMeasurements(ordinary, measurements),
			contracts: leafIncidentContracts(context, 'ordinary', sides),
		};
		const originalOrdinary = solveDedicatedRegionLeafWithIncidents(ordinaryInput);
		expect(originalOrdinary.status).toBe(RegionCompositionStatus.Selected);
		const ordinarySearch = enumerateRegionLeafLayoutsWithIncidents({
			...ordinaryInput,
			leafPolicy: LayoutPolicy.Layered,
		});
		expect(ordinarySearch.next().value).toEqual(originalOrdinary);
		const secondOrdinary = ordinarySearch.next();
		expect(secondOrdinary.done).toBe(false);
		if (
			secondOrdinary.done === true ||
			originalOrdinary.status !== RegionCompositionStatus.Selected
		)
			throw new Error('Expected two accepted dedicated alternatives');
		expect(secondOrdinary.value.incidents).not.toEqual(originalOrdinary.incidents);
		expect(secondOrdinary.value.witness.attempted).toBeGreaterThan(
			originalOrdinary.witness.attempted,
		);
		const preservedWitness = JSON.stringify(secondOrdinary.value.witness);
		let dedicatedResult = ordinarySearch.next();
		let accepted = 2;
		while (dedicatedResult.done === false) {
			accepted += 1;
			dedicatedResult = ordinarySearch.next();
		}
		if (dedicatedResult.done !== true) throw new Error('Incomplete dedicated search');
		expect(JSON.stringify(secondOrdinary.value.witness)).toBe(preservedWitness);
		expect(accepted).toBeGreaterThan(2);
		expect(dedicatedResult.value.attempted).toBeLessThanOrEqual(8_192);
		expect(
			dedicatedResult.value.rejectedAlternatives.some(
				({ relationId, candidateId }) => relationId === 'cross' && candidateId !== undefined,
			),
		).toBe(true);
	});

	it('selects the valid, shorter no-bridge composed route before a bridge', () => {
		const { selected, unbridged } = alternatives();
		expect(validatedBridges(selected.layout.relations)).toEqual([]);
		expect(layoutRouteCost(selected.layout)).toEqual(layoutRouteCost(unbridged.layout));
		expect(selected.searchWitness).toMatchObject({
			bestDetour: layoutRouteCost(selected.layout),
			selected: 'detour',
		});
		expect(selected.searchWitness?.bestBridge?.area).toBe(834624);
		expect(selected.searchWitness?.bestDetourIndices).toBeDefined();
		expect(selected.searchWitness?.bestBridgeIndices).toBeDefined();
		expect(selected.searchWitness?.attempted).toBeLessThanOrEqual(64);
	});
	it('keeps both issue costs and the selected geometry stable across permutations and cache edits', () => {
		const cache = new RegionLocalLayoutCache();
		const baseline = solve();
		fc.assert(
			fc.property(
				fc.shuffledSubarray([...document.nodes], {
					minLength: document.nodes.length,
					maxLength: document.nodes.length,
				}),
				fc.shuffledSubarray([...document.relations], {
					minLength: document.relations.length,
					maxLength: document.relations.length,
				}),
				(nodes, relations) => {
					const graph = createGraph({ ...document, nodes, relations });
					if (!graph.ok) throw new Error('Invalid permutation of the witness');
					const input = nestedRegionInput(graph.value);
					const warm = solveRecursiveNestedRegionLayout(graph.value, measurements, input, cache);
					const cold = solveRecursiveNestedRegionLayout(graph.value, measurements, input);
					expect(warm).toEqual(cold);
					expect(warm.status).toBe(RegionCompositionStatus.Selected);
					if (warm.status !== RegionCompositionStatus.Selected) return;
					expect(layoutRouteCost(warm.layout)).toEqual(layoutRouteCost(baseline.layout));
					expect(warm.searchWitness?.bestDetour).toEqual(baseline.searchWitness?.bestDetour);
					expect(warm.searchWitness?.bestBridge).toEqual(baseline.searchWitness?.bestBridge);
					expect(validatedBridges(warm.layout.relations)).toEqual([]);
				},
			),
			{ ...PROPERTY_PARAMETERS, numRuns: 20 },
		);
	});
	it('retries a rejected full composition and retains a separately valid bridged issue', () => {
		const extended = {
			...document,
			relations: [...document.relations, { id: 'extra-cross', from: 'a', to: 'c' }],
		};
		const graph = createGraph(extended);
		if (!graph.ok) throw new Error('Invalid composed crossing document');
		const sizes = {
			nodes: new Map(extended.nodes.map(({ id }) => [id, { width: 80, height: 64 }])),
			groups: new Map(),
			junctions: new Map(),
		};
		const input = nestedRegionInput(graph.value);
		const cold = solveRecursiveNestedRegionLayout(graph.value, sizes, input);
		const cache = new RegionLocalLayoutCache();
		expect(solveRecursiveNestedRegionLayout(graph.value, sizes, input, cache)).toEqual(cold);
		if (cold.status !== RegionCompositionStatus.Selected)
			throw new Error('Expected a valid bridge');
		expect(cold.searchWitness?.rejectedAlternatives).toContainEqual({
			indices: [0, 0],
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
		});
		expect(cold.searchWitness?.bestDetour).toBeUndefined();
		expect(cold.searchWitness?.bestBridge).toEqual(layoutRouteCost(cold.layout));
		expect(cold.searchWitness?.bestBridgeIndices).toEqual([0, 3]);
		expect(cold.searchWitness?.selected).toBe('bridge');
		expect(validatedBridges(cold.layout.relations).length).toBeGreaterThan(0);
		const normalized = normalizeRegionCompositionModel(graph.value, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready) throw new Error('Expected model');
		expect(validateRegionCompositionGeometry(normalized.model, cold)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, cold)).toBeUndefined();
	});
});
