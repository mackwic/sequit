import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { crossingIncidence } from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type { GridCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import { crossingBusOrderCandidates } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-bus-orders';
import {
	FREE_TRACK,
	trackOrders,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-orders';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import {
	crossingRoutes,
	gridCrossingRouting,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-routing';
import type { VariedGridRoutingCase } from './grid-cell-crossing-allocation-fixture';
import { variedGridRoutingCase } from './grid-cell-crossing-allocation-fixture';

function renamedFixture(
	fixture: VariedGridRoutingCase,
	idByOriginal: ReadonlyMap<string, string>,
): VariedGridRoutingCase {
	const remap = (id: string) => defined(idByOriginal.get(id));
	const crossing = fixture.crossing.map((relation) => ({ ...relation, id: remap(relation.id) }));
	const incidence = new Map(
		[...fixture.input.incidence].map(([endpointId, ids]) => [endpointId, ids.map(remap)]),
	);
	const routing = gridCrossingRouting({
		rootId: fixture.routing.rootId,
		crossing,
		columnCount: fixture.routing.columnCount,
		cells: fixture.routing.cells,
		cellByEndpointId: fixture.routing.cellByEndpointId,
		edges: fixture.routing.edges,
		incidence,
		nestedEndpointIds: fixture.routing.nestedEndpointIds,
	});
	const input = {
		...fixture.input,
		crossingIds: fixture.input.crossingIds.map(remap),
		busRelevantRelationIds: fixture.input.busRelevantRelationIds.map(remap),
		gutterIds: fixture.input.gutterIds.map((ids) => ids.map(remap)),
		rowGutterIds: fixture.input.rowGutterIds?.map((ids) => ids.map(remap)),
		incidence,
		portalByRelationId: new Map(
			[...fixture.input.portalByRelationId].map(([id, span]) => [remap(id), span]),
		),
	};
	return { ...fixture, input, routing, crossing };
}

function withComputedIncidence(fixture: VariedGridRoutingCase): VariedGridRoutingCase {
	const incidence = crossingIncidence(fixture.crossing);
	const routing = gridCrossingRouting({
		rootId: fixture.routing.rootId,
		crossing: fixture.crossing,
		columnCount: fixture.routing.columnCount,
		cells: fixture.routing.cells,
		cellByEndpointId: fixture.routing.cellByEndpointId,
		edges: fixture.routing.edges,
		incidence,
		nestedEndpointIds: fixture.routing.nestedEndpointIds,
	});
	return { ...fixture, input: { ...fixture.input, incidence }, routing };
}

function normalizedRouteGeometry(
	fixture: VariedGridRoutingCase,
	allocation: GridCrossingAllocation,
	originalIdByCurrent: ReadonlyMap<string, string>,
): string {
	const remap = (id: string) => defined(originalIdByCurrent.get(id));
	return JSON.stringify(
		crossingRoutes(fixture.routing, allocation).map(({ route, portals }) => ({
			route: { ...route, id: remap(route.id) },
			portals: portals.map((portal) => ({
				...portal,
				relationId: remap(portal.relationId),
			})),
		})),
	);
}

function originalIdsByCurrent(
	idByOriginal: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
	return new Map([...idByOriginal].map(([id, renamed]) => [renamed, id]));
}

function busRouteCandidates(
	fixture: VariedGridRoutingCase,
	originalIdByCurrent: ReadonlyMap<string, string>,
): readonly string[] {
	const canonical = canonicalCrossingAllocation(fixture.input);
	return [...crossingBusOrderCandidates(fixture.input)].map((order) => {
		const busTrackByRelationId = new Map<string, number>();
		for (const [track, id] of order.entries())
			if (id !== FREE_TRACK) busTrackByRelationId.set(id, track);
		return normalizedRouteGeometry(
			fixture,
			{ ...canonical, busTrackByRelationId },
			originalIdByCurrent,
		);
	});
}

function gutterRouteCandidates(
	fixture: VariedGridRoutingCase,
	originalIdByCurrent: ReadonlyMap<string, string>,
): readonly string[] {
	const canonical = canonicalCrossingAllocation(fixture.input);
	const ids = defined(fixture.input.gutterIds[0]);
	const edge = defined(fixture.input.edges.gutters[0]);
	return [...trackOrders(ids, edge.capacity)].map((order) => {
		const tracks = new Map<string, number>();
		for (const [track, id] of order.entries()) if (id !== FREE_TRACK) tracks.set(id, track);
		const gutterTrackByRelationId = [...canonical.gutterTrackByRelationId];
		gutterTrackByRelationId[0] = tracks;
		return normalizedRouteGeometry(
			fixture,
			{ ...canonical, gutterTrackByRelationId },
			originalIdByCurrent,
		);
	});
}

function singleGeometry(
	fixture: VariedGridRoutingCase,
	allocation: GridCrossingAllocation,
	originalIdByCurrent: ReadonlyMap<string, string>,
): string {
	return normalizedRouteGeometry(fixture, allocation, originalIdByCurrent);
}

const ID_BY_ORIGINAL = new Map([
	['route-0', 'z-inert'],
	['route-1', 'a-bus'],
	['route-2', 'b-bus'],
	['route-3', 'c-bus'],
]);

describe('grid relation-id order invariance', () => {
	it('keeps grid resource identifiers in documentary relation order', () => {
		const original = variedGridRoutingCase(4, 2, 2, 1);
		const renamed = renamedFixture(original, ID_BY_ORIGINAL);
		const originalResources = gridCrossingResources(original.gridInput, original.crossing);
		const renamedResources = gridCrossingResources(renamed.gridInput, renamed.crossing);
		const originalIdByCurrent = originalIdsByCurrent(ID_BY_ORIGINAL);
		expect(
			renamedResources.gutterIds.map((ids) =>
				ids.map((id) => defined(originalIdByCurrent.get(id))),
			),
		).toEqual(originalResources.gutterIds);
		expect(
			renamedResources.rowGutterIds.map((ids) =>
				ids.map((id) => defined(originalIdByCurrent.get(id))),
			),
		).toEqual(originalResources.rowGutterIds);
		expect(renamedResources.edges).toEqual(originalResources.edges);
	});

	it('keeps documentary-first bus proposals and inert-route placement', () => {
		const original = variedGridRoutingCase(4, 2, 2, 1);
		const renamed = renamedFixture(original, ID_BY_ORIGINAL);
		const identity = new Map(original.crossing.map(({ id }) => [id, id]));
		const inverse = originalIdsByCurrent(ID_BY_ORIGINAL);
		expect(busRouteCandidates(original, identity)).toEqual(busRouteCandidates(renamed, inverse));
	});

	it('keeps gutter proposal geometry documentary, with free tracks first', () => {
		const original = variedGridRoutingCase(4, 2, 2, 1);
		const renamed = renamedFixture(original, ID_BY_ORIGINAL);
		const identity = new Map(original.crossing.map(({ id }) => [id, id]));
		const inverse = originalIdsByCurrent(ID_BY_ORIGINAL);
		expect(gutterRouteCandidates(original, identity)).toEqual(
			gutterRouteCandidates(renamed, inverse),
		);
	});

	it('keeps containment interval ties documentary after relation ids are renamed', () => {
		const original = variedGridRoutingCase(4, 2, 2, 1);
		const renamed = renamedFixture(original, ID_BY_ORIGINAL);
		const identity = new Map(original.crossing.map(({ id }) => [id, id]));
		const inverse = originalIdsByCurrent(ID_BY_ORIGINAL);
		const originalGeometry = singleGeometry(
			original,
			containmentCrossingAllocation(original.input),
			identity,
		);
		const renamedGeometry = singleGeometry(
			renamed,
			containmentCrossingAllocation(renamed.input),
			inverse,
		);
		expect(originalGeometry).toEqual(renamedGeometry);
	});

	it('keeps canonical port tracks documentary after relation ids are renamed', () => {
		const original = withComputedIncidence(variedGridRoutingCase(4, 2, 2, 1));
		const renamed = withComputedIncidence(renamedFixture(original, ID_BY_ORIGINAL));
		const identity = new Map(original.crossing.map(({ id }) => [id, id]));
		const inverse = originalIdsByCurrent(ID_BY_ORIGINAL);
		const originalGeometry = singleGeometry(
			original,
			canonicalCrossingAllocation(original.input),
			identity,
		);
		const renamedGeometry = singleGeometry(
			renamed,
			canonicalCrossingAllocation(renamed.input),
			inverse,
		);
		expect(originalGeometry).toEqual(renamedGeometry);
	});
});
