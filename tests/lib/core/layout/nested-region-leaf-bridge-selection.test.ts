import { describe, expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import type { Point } from '../../../../src/lib/core/layout/layout-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionLayoutSelected,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { layoutRouteCost } from '../../../../src/lib/core/layout/routing/route-cost';
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
		expect(layoutRouteCost(bridged.layout)).toEqual({ area: 834624, routeLength: 1715, bends: 10 });
		expect(layoutRouteCost(unbridged.layout)).toEqual({
			area: 834624,
			routeLength: 1631,
			bends: 10,
		});
	});

	it.fails('selects the valid, shorter no-bridge composed route before a bridge', () => {
		const { selected, unbridged } = alternatives();
		expect(validatedBridges(selected.layout.relations)).toEqual([]);
		expect(layoutRouteCost(selected.layout)).toEqual(layoutRouteCost(unbridged.layout));
	});
});
