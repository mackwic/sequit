import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	type RegionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	canonicalCrossingAllocation,
	containmentCrossingAllocation,
	crossingAllocationCandidates,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import {
	crossingCanonicalBusGeometryCount,
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
	type GridCrossingAllocationBudgets,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import {
	GridCrossingSearchMode,
	searchGridCrossingAllocations,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-search';
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
				expect(
					defined(candidate.gutterTrackByRelationId[column]).get(relationId),
				).toBe(defined(baseline.gutterTrackByRelationId[column]).get(relationId));
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
	it('validates independent phase budgets at safe-integer boundaries', () => {
		const input = variedGridRoutingCase(1, 2, 0).input;
		const budgets: GridCrossingAllocationBudgets = { reallocate: 7, extraTrack: 8, bridge: 9 };
		expect(
			crossingAllocationPhases(input, budgets).map(({ budget, acceptBridges }) => ({
				budget,
				acceptBridges,
			})),
		).toEqual([
			{ budget: 7, acceptBridges: false },
			{ budget: 8, acceptBridges: false },
			{ budget: 9, acceptBridges: true },
		]);

		for (const invalid of [
			{ ...budgets, reallocate: 0 },
			{ ...budgets, extraTrack: -1 },
			{ ...budgets, bridge: Number.NaN },
			{ ...budgets, reallocate: Number.MAX_SAFE_INTEGER + 1 },
		])
			expect(() => crossingAllocationPhases(input, invalid)).toThrow(RangeError);
	});
	it('counts canonical bus blocks and excludes inherited-incident gutters from extra-track candidates', () => {
		const input = variedGridRoutingCase(2, 2, 0, 1).input;
		const canonical = canonicalCrossingAllocation(input);
		const candidates = [...crossingAllocationCandidates(input)];
		const canonicalBlockSize = candidates.filter((candidate) =>
			input.busRelevantRelationIds.every(
				(id) => candidate.busTrackByRelationId.get(id) === canonical.busTrackByRelationId.get(id),
			),
		).length;
		expect(crossingCanonicalBusGeometryCount(input)).toBe(BigInt(canonicalBlockSize));

		const blockedColumns = new Set(
			input.gutterIds.flatMap((ids, column) => (ids.length > 0 ? [column] : [])),
		);
		expect(blockedColumns.size).toBeGreaterThan(0);
		const blockedInput = { ...input, blockedExtraGutterColumns: blockedColumns };
		const extraTrack = defined(crossingAllocationPhases(blockedInput)[1]);
		expect(extraTrack.totalGeometries(blockedInput)).toBe(0n);
		expect([...extraTrack.candidates(blockedInput)]).toEqual([]);
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
		for (const [column, ids] of fixture.input.gutterIds.entries())
			for (const id of ids)
				if (!active.has(id))
					expect(defined(prioritizedBus.gutterTrackByRelationId[column]).get(id)).toBe(
						defined(canonical.gutterTrackByRelationId[column]).get(id),
					);
		sharesUnchangedTracks(prioritizedBus, canonical, fixture.input, active);

		const observedFailures: RegionGeometryDiagnostic[] = [];
		const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) => {
			const attempt = routeGridFixture(fixture, allocation, acceptBridges);
			if (attempt.failure !== undefined) observedFailures.push(attempt.failure);
			return attempt;
		};
		const result = searchGridCrossingAllocations(fixture.input, route);
		if (!('selected' in result)) throw new Error('The later bridge phase must find a valid allocation.');
		const reallocation = defined(result.witness.phases[0]);
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		expect(reallocation.exploredGeometries).toBe(256);
		expect(Number(reallocation.totalGeometries)).toBeGreaterThan(reallocation.exploredGeometries);
		expect(reallocation.truncated).toBe(true);
		expect(result.witness.rejectedAlternatives[0]).toMatchObject({
			phaseId: CrossingAllocationPhaseId.Reallocate,
			busOrder: busOrder(canonical),
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
		});
		expect(observedFailures.length).toBe(result.witness.rejectedAlternatives.length);
		const laterConflict = observedFailures.findIndex(
			({ relationId, relatedRelationId }) =>
				(relationId === 'route-0' && relatedRelationId === 'route-2') ||
				(relationId === 'route-2' && relatedRelationId === 'route-0'),
		);
		expect(laterConflict).toBeGreaterThan(255);
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
	it('stops after the first valid reallocation and leaves later phases unattempted', () => {
		const fixture = variedGridRoutingCase(1, 2, 0);
		const result = searchGridCrossingAllocations(
			fixture.input,
			(allocation, acceptBridges) => routeGridFixture(fixture, allocation, acceptBridges),
			{ reallocate: 1, extraTrack: 2, bridge: 3 },
		);
		if (!('selected' in result)) throw new Error('The canonical route must pass geometry validation.');
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Reallocate);
		expect(result.witness.phases.map(({ attempted, selected }) => ({ attempted, selected }))).toEqual([
			{ attempted: true, selected: true },
			{ attempted: false, selected: false },
			{ attempted: false, selected: false },
		]);
		expect(result.witness.phases.map(({ exploredGeometries }) => exploredGeometries)).toEqual([1, 0, 0]);
	});

	it('returns the real geometry failure when all phase geometries are exhausted', () => {
		const fixture = variedGridRoutingCase(2, 2, 0);
		const phases = crossingAllocationPhases(fixture.input);
		const budgets: GridCrossingAllocationBudgets = {
			reallocate: Number(defined(phases[0]).totalGeometries(fixture.input)),
			extraTrack: Number(defined(phases[1]).totalGeometries(fixture.input)),
			bridge: Number(defined(phases[2]).totalGeometries(fixture.input)),
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
		expect(result.witness.phases.map(({ exploredGeometries }) => exploredGeometries)).toEqual([
			budgets.reallocate,
			budgets.extraTrack,
			budgets.bridge,
		]);
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
		]);
	});


});
