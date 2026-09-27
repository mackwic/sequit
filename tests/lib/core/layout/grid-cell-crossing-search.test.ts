import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import { crossingIncidence } from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
	crossingAllocationCandidates,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type { GridCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import {
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
	crossingCanonicalBusGeometryCount,
	type GridCrossingAllocationBudgets,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import {
	GridCrossingSearchMode,
	searchGridCrossingAllocations,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-search';
import { gridOf } from '../../../support/performance/layout-resource-scenarios';
import {
	effectiveRouteGeometry,
	routeGridFixture,
	variedGridRoutingCase,
} from './grid-cell-crossing-allocation-fixture';

function busOrder(allocation: GridCrossingAllocation): readonly string[] {
	return [...allocation.busTrackByRelationId]
		.sort(([, left], [, right]) => left - right)
		.map(([relationId]) => relationId);
}

function sharesUnchangedTracks(
	candidate: GridCrossingAllocation,
	baseline: GridCrossingAllocation,
	input: ReturnType<typeof variedGridRoutingCase>['input'],
	active: ReadonlySet<string>,
): void {
	for (const [column, ids] of input.gutterIds.entries())
		for (const relationId of ids)
			if (!active.has(relationId))
				expect(defined(candidate.gutterTrackByRelationId[column]).get(relationId)).toBe(
					defined(baseline.gutterTrackByRelationId[column]).get(relationId),
				);
	for (const relationId of input.crossingIds)
		if (!active.has(relationId))
			expect(candidate.busTrackByRelationId.get(relationId)).toBe(
				baseline.busTrackByRelationId.get(relationId),
			);
	for (const [endpointId, ids] of input.incidence)
		for (const relationId of ids)
			if (!active.has(relationId))
				expect(defined(candidate.portTrackByEndpointId.get(endpointId)).get(relationId)).toBe(
					defined(baseline.portTrackByEndpointId.get(endpointId)).get(relationId),
				);
}

describe('grid crossing allocation search examples', () => {
	it('bounds declared counting work for one hundred crossings across a 10×10 grid', () => {
		const grid = gridOf(10, 10);
		const crossings = Array.from({ length: 100 }, (_, index) => {
			const row = Math.floor(index / 10);
			const column = index % 10;
			const nextRow = (row + 1) % 10;
			return {
				id: `cross-${index}`,
				from: `node-${row * 10 + column}`,
				to: `node-${nextRow * 10 + ((column + 1) % 10)}`,
			};
		});
		const resources = gridCrossingResources(grid.input, crossings);
		const input = {
			...resources,
			crossingIds: crossings.map(({ id }) => id),
			busRelevantRelationIds: crossings.map(({ id }) => id),
			incidence: crossingIncidence(crossings),
			portalByRelationId: new Map(),
		};
		const row = defined(crossingAllocationPhases(input)[0]);
		expect(row.totalGeometries()).toBe(257n);
		// Isolate the row-load counting path, excluding the inexpensive column/port products.
		const rowOnly = {
			...input,
			gutterIds: [],
			incidence: new Map(),
		};
		expect(defined(crossingAllocationPhases(rowOnly)[0]).totalGeometries()).toBe(257n);
		const result = searchGridCrossingAllocations(input, (allocation) => ({
			candidate: allocation,
		}));
		expect('selected' in result).toBe(true);
		expect(result.witness.phases[0]).toMatchObject({
			selected: true,
			exploredGeometries: 1,
			totalGeometries: '257',
			totalGeometriesKind: 'lower-bound',
			exhaustive: false,
		});
	}, 5_000);

	it('rejects invalid phase work budgets at their boundaries', () => {
		const input = variedGridRoutingCase(1, 2, 0).input;
		const budgets: GridCrossingAllocationBudgets = {
			rowGutter: 1,
			reallocate: 1,
			extraTrack: 1,
			bridge: 1,
		};

		for (const invalid of [
			{ ...budgets, reallocate: 0 },
			{ ...budgets, extraTrack: -1 },
			{ ...budgets, bridge: Number.NaN },
			{ ...budgets, reallocate: Number.MAX_SAFE_INTEGER + 1 },
		])
			expect(() => crossingAllocationPhases(input, invalid)).toThrow(RangeError);
	});
	it('counts canonical bus blocks independently of their allocation iterator', () => {
		const input = variedGridRoutingCase(2, 2, 0, 1).input;
		const canonical = canonicalCrossingAllocation(input);
		const candidates = [...crossingAllocationCandidates(input)];
		const canonicalBlockSize = candidates.filter((candidate) =>
			input.busRelevantRelationIds.every(
				(id) => candidate.busTrackByRelationId.get(id) === canonical.busTrackByRelationId.get(id),
			),
		).length;
		expect(crossingCanonicalBusGeometryCount(input)).toBe(BigInt(canonicalBlockSize));
	});

	it('starts the bus phase with the legacy priority prefix, ignoring row-phase conflicts', () => {
		const fixture = variedGridRoutingCase(3, 2, 2);
		const attempts: GridCrossingAllocation[] = [];
		const busInput = { ...fixture.input, rowGutterIds: [] };
		const budgets = { rowGutter: 1, reallocate: 8, extraTrack: 1, bridge: 1 };
		searchGridCrossingAllocations(
			fixture.input,
			(allocation) => {
				attempts.push(allocation);
				let relationId = 'route-2';
				if (attempts.length === 1) relationId = 'route-0';
				return {
					candidate: allocation,
					failure: regionGeometryDiagnostic(
						RegionGeometryDiagnosticCode.GridCrossingEntersElement,
						'Declared obstacle blocks this candidate.',
						{ relationId },
					),
				};
			},
			budgets,
		);
		const geometry = (candidate: GridCrossingAllocation) =>
			effectiveRouteGeometry(fixture.routing, fixture.crossing, candidate);
		const legacyPrefix: string[] = [];
		for (const choices of [
			[canonicalCrossingAllocation(busInput)],
			crossingAllocationCandidates(busInput, new Set(['route-2']), true),
			crossingAllocationCandidates(busInput),
		]) {
			for (const candidate of choices) {
				const key = geometry(candidate);
				if (!legacyPrefix.includes(key)) legacyPrefix.push(key);
				if (legacyPrefix.length === 8) break;
			}
			if (legacyPrefix.length === 8) break;
		}
		expect(attempts.slice(1, 9).map(geometry)).toEqual(legacyPrefix);
	});
	it('uses observed crossing conflicts to prioritize only the affected tracks before the bridge phase', () => {
		const fixture = variedGridRoutingCase(3, 2, 2);
		const canonical = canonicalCrossingAllocation(fixture.input);
		const initial = routeGridFixture(fixture, canonical, false);
		const conflict = defined(initial.failure);
		expect(conflict.code).toBe(RegionGeometryDiagnosticCode.ParentRouteContact);
		const conflictIds = [conflict.relationId, conflict.relatedRelationId].filter(
			(id): id is string => id !== undefined,
		);
		expect(conflictIds).toEqual(['route-0', 'route-1']);
		const active = new Set(conflictIds);

		const canonicalOrder = busOrder(canonical);
		const priority = [...crossingAllocationCandidates(fixture.input, active, true)];
		const priorityBusOrder = priority.find((candidate) =>
			busOrder(candidate).some((id, index) => id !== canonicalOrder[index]),
		);
		const prioritizedBus = defined(priorityBusOrder);
		expect(priority[0]).toEqual(canonical);
		expect(busOrder(prioritizedBus)).not.toEqual(canonicalOrder);
		sharesUnchangedTracks(prioritizedBus, canonical, fixture.input, active);

		const observedFailures: RegionGeometryDiagnostic[] = [];
		const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) => {
			const attempt = routeGridFixture(fixture, allocation, acceptBridges);
			if (attempt.failure !== undefined) observedFailures.push(attempt.failure);
			return attempt;
		};
		const result = searchGridCrossingAllocations(fixture.input, route);
		if (!('selected' in result))
			throw new Error('The later bridge phase must find a valid allocation.');
		const reallocation = defined(result.witness.phases[1]);
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		expect(reallocation.exploredGeometries).toBeGreaterThan(0);
		expect(Number(reallocation.totalGeometries)).toBeGreaterThan(reallocation.exploredGeometries);
		expect(reallocation.truncated).toBe(true);
		expect(result.witness.rejectedAlternatives[0]).toMatchObject({
			phaseId: CrossingAllocationPhaseId.RowGutter,
			busOrder: busOrder(canonical),
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
		});
		expect(observedFailures.length).toBe(result.witness.rejectedAlternatives.length);
		expect(route(result.selected.allocation, true).failure).toBeUndefined();
	});
	it('does not prioritize containment when the observed route failure leaves that unrelated route fixed', () => {
		const fixture = variedGridRoutingCase(3, 2, 4);
		const canonical = canonicalCrossingAllocation(fixture.input);
		const conflict = defined(routeGridFixture(fixture, canonical, false).failure);
		expect(conflict.relationId).toBe('route-0');
		expect(conflict.relatedRelationId).toBeUndefined();
		const active = new Set([defined(conflict.relationId)]);
		const containment = containmentCrossingAllocation(fixture.input);
		const unrelatedMove = fixture.input.crossingIds.some(
			(id) =>
				!active.has(id) &&
				(containment.busTrackByRelationId.get(id) !== canonical.busTrackByRelationId.get(id) ||
					fixture.input.gutterIds.some(
						(ids, column) =>
							ids.includes(id) &&
							defined(containment.gutterTrackByRelationId[column]).get(id) !==
								defined(canonical.gutterTrackByRelationId[column]).get(id),
					)),
		);
		expect(unrelatedMove).toBe(true);
		const candidates = [...crossingAllocationCandidates(fixture.input, active)];
		const containmentGeometry = effectiveRouteGeometry(
			fixture.routing,
			fixture.crossing,
			containment,
		);
		const ordinaryCandidates = [...crossingAllocationCandidates(fixture.input)];
		expect(
			effectiveRouteGeometry(fixture.routing, fixture.crossing, defined(ordinaryCandidates[1])),
		).toBe(containmentGeometry);
		expect(
			candidates.findIndex(
				(candidate) =>
					effectiveRouteGeometry(fixture.routing, fixture.crossing, candidate) ===
					containmentGeometry,
			),
		).toBe(-1);
		for (const candidate of candidates)
			sharesUnchangedTracks(candidate, canonical, fixture.input, active);
	});
	it('stops after the first valid row candidate and leaves later phases unattempted', () => {
		const fixture = variedGridRoutingCase(1, 2, 0);
		const result = searchGridCrossingAllocations(
			fixture.input,
			(allocation, acceptBridges) => routeGridFixture(fixture, allocation, acceptBridges),
			{ rowGutter: 1, reallocate: 1, extraTrack: 2, bridge: 3 },
		);
		if (!('selected' in result))
			throw new Error('The canonical route must pass geometry validation.');
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.RowGutter);
		expect(
			result.witness.phases.map(({ attempted, selected }) => ({ attempted, selected })),
		).toEqual([
			{ attempted: true, selected: true },
			{ attempted: false, selected: false },
			{ attempted: false, selected: false },
			{ attempted: false, selected: false },
		]);
	});

	it('returns the real geometry failure when all phase geometries are exhausted', () => {
		const fixture = variedGridRoutingCase(2, 2, 0);
		const phases = crossingAllocationPhases(fixture.input);
		const budgets: GridCrossingAllocationBudgets = {
			rowGutter: Number(defined(phases[0]).totalGeometries()),
			reallocate: Number(defined(phases[1]).totalGeometries()),
			extraTrack: Number(defined(phases[2]).totalGeometries()),
			bridge: Number(defined(phases[3]).totalGeometries()),
		};
		const result = searchGridCrossingAllocations(
			fixture.input,
			(allocation, acceptBridges) => routeGridFixture(fixture, allocation, acceptBridges),
			budgets,
			GridCrossingSearchMode.Exhaustive,
		);
		if (!('failure' in result)) throw new Error('Every route allocation is blocked by an element.');
		expect(result.failure.code).toBe(RegionGeometryDiagnosticCode.GridCrossingEntersElement);
		expect(result.witness.exhaustive).toBe(true);
		expect(
			result.witness.phases.map(({ attempted, exhaustive, truncated, selected }) => ({
				attempted,
				exhaustive,
				truncated,
				selected,
			})),
		).toEqual([
			{ attempted: true, exhaustive: true, truncated: false, selected: false },
			{ attempted: true, exhaustive: true, truncated: false, selected: false },
			{ attempted: true, exhaustive: true, truncated: false, selected: false },
			{ attempted: true, exhaustive: true, truncated: false, selected: false },
		]);
	});
});
