import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	canonicalCrossingAllocation,
	crossingBusOrderCandidates,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import {
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
	crossingCanonicalBusGeometryCount,
	GRID_CROSSING_REALLOCATION_BUDGET,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { crossingRoute } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-routing';
import {
	GridCrossingSearchMode,
	searchGridCrossingAllocations,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-search';
import { entersInterior } from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	effectiveRouteGeometry,
	routeGridFixture,
	variedGridRoutingCase,
} from './grid-cell-crossing-allocation-fixture';

describe('grid crossing allocation route geometry properties', () => {
	it('compares exact cardinality with route points and portals on admissible grids', () => {
		fc.assert(
			fc.property(
				fc.record({
					crossingCount: fc.integer({ min: 1, max: 2 }),
					columnCount: fc.integer({ min: 2, max: 3 }),
					seed: fc.integer({ min: 0, max: 127 }),
					sameRail: fc.boolean(),
				}),
				({ crossingCount, columnCount, seed, sameRail }) => {
					const { input, routing, crossing } = variedGridRoutingCase(
						crossingCount,
						columnCount,
						seed,
						sameRail,
					);
					const phases = crossingAllocationPhases(input);
					const reallocation = [...defined(phases[0]).candidates(input)];
					const extraTrack = [...defined(phases[1]).candidates(input)];
					const bridge = [...defined(phases[2]).candidates(input)];
					expect(reallocation[0]).toEqual(canonicalCrossingAllocation(input));
					for (const [phaseIndex, candidates] of [reallocation, extraTrack, bridge].entries()) {
						const phase = defined(phases[phaseIndex]);
						const geometries = candidates.map((allocation) =>
							effectiveRouteGeometry(routing, crossing, allocation),
						);
						expect(new Set(geometries).size).toBe(candidates.length);
						expect(BigInt(new Set(geometries).size)).toBe(phase.totalGeometries(input));
					}
					const existingGeometry = new Set(
						reallocation.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					);
					for (const allocation of extraTrack)
						expect(
							existingGeometry.has(effectiveRouteGeometry(routing, crossing, allocation)),
						).toBe(false);
					for (const allocation of extraTrack)
						expect(
							allocation.gutterTrackByRelationId.some((tracks, column) =>
								[...tracks.values()].includes(defined(input.edges.gutters[column]).capacity - 1),
							),
						).toBe(true);
					expect(
						bridge.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					).toEqual(
						reallocation.map((allocation) => effectiveRouteGeometry(routing, crossing, allocation)),
					);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
	it('constructs only effective bus proposals even when eight routes stay in one column', () => {
		const sameColumn = variedGridRoutingCase(8, 2, 0, true).input;
		expect(sameColumn.busRelevantRelationIds).toEqual([]);
		const allConflicting = new Set(sameColumn.crossingIds);
		let priorityProposals = 0;
		for (const busOrder of crossingBusOrderCandidates(sameColumn, allConflicting)) {
			expect(busOrder).toEqual(sameColumn.crossingIds);
			priorityProposals += 1;
		}
		expect(priorityProposals).toBe(1);
		expect([...crossingBusOrderCandidates(sameColumn)]).toHaveLength(1);

		const mixed = variedGridRoutingCase(9, 2, 0, 8).input;
		expect(mixed.busRelevantRelationIds).toHaveLength(1);
		let completeProposals = 0;
		for (const busOrder of crossingBusOrderCandidates(mixed)) {
			expect(new Set(busOrder).size).toBe(9);
			completeProposals += 1;
		}
		expect(completeProposals).toBe(9);
		expect([...crossingBusOrderCandidates(mixed, new Set(mixed.crossingIds))]).toHaveLength(1);
	});

	it('keeps unrelated tracks and ports fixed in each conflict-first prefix', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 127 }),
				fc.integer({ min: 2, max: 3 }),
				fc.integer({ min: 0, max: 2 }),
				(seed, columns, activeIndex) => {
					const { input, routing, crossing } = variedGridRoutingCase(3, columns, seed);
					const active = new Set([defined(input.crossingIds[activeIndex])]);
					const canonical = canonicalCrossingAllocation(input);
					for (const phase of crossingAllocationPhases(input)) {
						const candidates = [...phase.candidates(input, active, true)];
						const geometries = candidates.map((candidate) =>
							effectiveRouteGeometry(routing, crossing, candidate),
						);
						expect(new Set(geometries).size).toBe(candidates.length);
						for (const candidate of candidates) {
							for (const [column, ids] of input.gutterIds.entries()) {
								const tracks = defined(candidate.gutterTrackByRelationId[column]);
								expect(new Set(tracks.values()).size).toBe(ids.length);
								for (const id of ids)
									if (!active.has(id))
										expect(tracks.get(id)).toBe(
											defined(canonical.gutterTrackByRelationId[column]).get(id),
										);
							}
							for (const id of input.crossingIds)
								if (!active.has(id))
									expect(candidate.busTrackByRelationId.get(id)).toBe(
										canonical.busTrackByRelationId.get(id),
									);
							for (const [endpoint, ids] of input.incidence)
								for (const id of ids)
									if (!active.has(id))
										expect(defined(candidate.portTrackByEndpointId.get(endpoint)).get(id)).toBe(
											defined(canonical.portTrackByEndpointId.get(endpoint)).get(id),
										);
						}
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('matches the exhaustive phase oracle on generated crossing routes', () => {
		fc.assert(
			fc.property(
				fc.record({
					crossingCount: fc.integer({ min: 0, max: 29 }).map((value) => {
						if (value === 0) return 3;
						return 1 + (value % 2);
					}),
					columnCount: fc.integer({ min: 2, max: 3 }),
					seed: fc.integer({ min: 0, max: 127 }),
					sameRail: fc.boolean(),
				}),
				({ crossingCount, columnCount, seed, sameRail }) => {
					const fixture = variedGridRoutingCase(crossingCount, columnCount, seed, sameRail);
					const { input } = fixture;
					const phases = crossingAllocationPhases(input);
					const budgets = {
						reallocate: Number(defined(phases[0]).totalGeometries(input)),
						extraTrack: Number(defined(phases[1]).totalGeometries(input)),
						bridge: Number(defined(phases[2]).totalGeometries(input)),
					};
					const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) =>
						routeGridFixture(fixture, allocation, acceptBridges);
					const oracle = searchGridCrossingAllocations(
						input,
						route,
						budgets,
						GridCrossingSearchMode.Exhaustive,
					);
					const pruned = searchGridCrossingAllocations(input, route, budgets);
					if ('selected' in oracle) {
						expect('selected' in pruned).toBe(true);
						if (!('selected' in pruned)) return;
						const order = Object.values(CrossingAllocationPhaseId);
						expect(order.indexOf(pruned.witness.winningPhase)).toBeLessThanOrEqual(
							order.indexOf(oracle.witness.winningPhase),
						);
						const acceptsBridges = pruned.witness.winningPhase === CrossingAllocationPhaseId.Bridge;
						expect(route(pruned.selected.allocation, acceptsBridges).failure).toBeUndefined();
						const firstBusBlock = crossingCanonicalBusGeometryCount(input);
						if (
							firstBusBlock <= BigInt(GRID_CROSSING_REALLOCATION_BUDGET) &&
							pruned.witness.winningPhase === CrossingAllocationPhaseId.Reallocate &&
							pruned.witness.winningPhase === oracle.witness.winningPhase
						)
							expect(pruned.selected.candidate.layout).toEqual(oracle.selected.candidate.layout);
					} else if (oracle.witness.exhaustive) {
						expect('selected' in pruned).toBe(false);
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	}, 120_000);
	it('keeps an exhaustively blocked gutter unknown when every track crosses an obstacle', () => {
		fc.assert(
			fc.property(fc.integer({ min: 12, max: 50 }), (obstacleWidth) => {
				const { input, routing, crossing } = variedGridRoutingCase(1, 2, 0);
				const sourceCell = defined(routing.cells.find(({ id }) => id === 'cell-0-0'));
				const obstacle = {
					x: sourceCell.bounds.x + 20,
					y: sourceCell.bounds.y,
					width: obstacleWidth,
					height: sourceCell.bounds.height,
				};
				const route = (allocation: GridCrossingAllocation) => {
					const path = crossingRoute(routing, allocation, defined(crossing[0])).route;
					const blocked = entersInterior(
						defined(path.points[0]),
						defined(path.points[1]),
						obstacle,
					);
					if (!blocked) return { candidate: path };
					return {
						candidate: path,
						failure: regionGeometryDiagnostic(
							RegionGeometryDiagnosticCode.GridCrossingEntersElement,
							`Cross-cell relation ${path.id} enters the gutter obstacle.`,
							{ relationId: path.id, endpointId: 'gutter-obstacle' },
						),
					};
				};
				const phases = crossingAllocationPhases(input);
				const budgets = {
					reallocate: Number(defined(phases[0]).totalGeometries(input)),
					extraTrack: Number(defined(phases[1]).totalGeometries(input)),
					bridge: Number(defined(phases[2]).totalGeometries(input)),
				};
				const oracle = searchGridCrossingAllocations(
					input,
					route,
					budgets,
					GridCrossingSearchMode.Exhaustive,
				);
				const pruned = searchGridCrossingAllocations(input, route);
				expect('failure' in oracle).toBe(true);
				expect(oracle.witness.exhaustive).toBe(true);
				expect('failure' in pruned).toBe(true);
				expect(pruned.witness.exhaustive).toBe(true);
			}),
			PROPERTY_PARAMETERS,
		);
	});
	it('discovers a second conflicting route beyond the reallocation budget and carries it to later phases', () => {
		const fixture = variedGridRoutingCase(3, 2, 2);
		const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) =>
			routeGridFixture(fixture, allocation, acceptBridges);
		const oracle = searchGridCrossingAllocations(
			fixture.input,
			route,
			undefined,
			GridCrossingSearchMode.Exhaustive,
		);
		const result = searchGridCrossingAllocations(fixture.input, route);
		expect('selected' in oracle).toBe(true);
		const first = result.witness.rejectedAlternatives[0];
		expect(first?.reason).toContain('route-0 and route-1');
		expect(Number(defined(result.witness.phases[0]).totalGeometries)).toBeGreaterThan(256);
		expect(defined(result.witness.phases[0]).exploredGeometries).toBe(256);
		const laterConflict = result.witness.rejectedAlternatives.findIndex(({ reason }) =>
			reason.includes('route-0 and route-2'),
		);
		expect(laterConflict).toBeGreaterThan(255);
		if (!('selected' in result)) throw new Error('Later phases must find a validated bridge.');
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		if (!('selected' in oracle)) throw new Error('The canonical budgeted search must select.');
		expect(oracle.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		expect(oracle.witness.phases[0]?.exploredGeometries).toBe(256);
		expect(oracle.witness.phases[1]?.exploredGeometries).toBe(256);
		expect(route(result.selected.allocation, true).failure).toBeUndefined();
		expect(route(oracle.selected.allocation, true).failure).toBeUndefined();
	});
});
