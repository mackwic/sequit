import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import { canonicalCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import { crossingBusOrderCandidates } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-bus-orders';
import {
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
	crossingCanonicalBusGeometryCount,
	GRID_CROSSING_REALLOCATION_BUDGET,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { routedPortAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-port-order';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import { crossingRoutes } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-routing';
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

/** Brute-force assignments for tiny cases; no phase candidate/size/search implementation is used. */
function slotAssignments(ids: readonly string[], slots: number): ReadonlyMap<string, number>[] {
	if (ids.length === 0) return [new Map()];
	const [first, ...rest] = ids;
	if (first === undefined) return [new Map()];
	return Array.from({ length: slots }, (_, slot) =>
		slotAssignments(rest, slots)
			.filter((assignment) => ![...assignment.values()].includes(slot))
			.map((assignment) => new Map([[first, slot], ...assignment])),
	).flat();
}

function allocationSignature(
	input: CrossingAllocationInput,
	allocation: GridCrossingAllocation,
): string {
	return JSON.stringify({
		bus: input.busRelevantRelationIds.map((id) => allocation.busTrackByRelationId.get(id)),
		gutters: input.gutterIds.map((ids, column) =>
			ids.map((id) => allocation.gutterTrackByRelationId[column]?.get(id)),
		),
		ports: [...input.incidence].map(([endpoint, ids]) =>
			ids.map((id) => allocation.portTrackByEndpointId.get(endpoint)?.get(id)),
		),
	});
}

function naiveAllocationSignatures(
	input: CrossingAllocationInput,
	extraTrack: boolean,
): Set<string> {
	const busAssignments = slotAssignments(input.busRelevantRelationIds, input.edges.topBus.capacity);
	let extraColumns: number[] = [-1];
	if (extraTrack)
		extraColumns = input.gutterIds
			.map((_, column) => column)
			.filter(
				(column) =>
					input.blockedExtraGutterColumns?.has(column) !== true &&
					defined(input.gutterIds[column]).length > 0,
			);
	const gutterChoices: ReadonlyMap<string, number>[][] = [];
	for (const extraColumn of extraColumns) {
		let combinations: ReadonlyMap<string, number>[][] = [[]];
		for (const [column, ids] of input.gutterIds.entries()) {
			const reserved = defined(input.edges.gutters[column]).capacity - 1;
			const choices = slotAssignments(ids, reserved + Number(extraColumn === column)).filter(
				(assignment) => extraColumn !== column || [...assignment.values()].includes(reserved),
			);
			combinations = combinations.flatMap((prefix) => choices.map((choice) => [...prefix, choice]));
		}
		gutterChoices.push(...combinations);
	}
	const ports = [...input.incidence];
	let portChoices: ReadonlyMap<string, ReadonlyMap<string, number>>[] = [new Map()];
	for (const [endpoint, ids] of ports) {
		portChoices = portChoices.flatMap((prefix) =>
			slotAssignments(ids, ids.length).map((choice) => new Map([...prefix, [endpoint, choice]])),
		);
	}
	const signatures = new Set<string>();
	for (const bus of busAssignments)
		for (const gutters of gutterChoices)
			for (const portMap of portChoices)
				signatures.add(
					allocationSignature(input, {
						busTrackByRelationId: bus,
						gutterTrackByRelationId: gutters,
						portTrackByEndpointId: portMap,
					}),
				);
	return signatures;
}

describe('grid crossing allocation route geometry properties', () => {
	it('counts row-track choices and top-bus fallbacks under input permutations', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 127 }),
				fc.integer({ min: 1, max: 2 }),
				(seed, count) => {
					const fixture = variedGridRoutingCase(count, 2, seed);
					const resources = gridCrossingResources(fixture.gridInput, fixture.crossing);
					const input = { ...fixture.input, rowGutterIds: resources.rowGutterIds };
					const phases = crossingAllocationPhases(input);
					for (const phase of phases)
						expect(BigInt([...phase.candidates()].length)).toBe(phase.totalGeometries());
					const budgets = {
						rowGutter: Number(defined(phases[0]).totalGeometries()),

						reallocate: Number(defined(phases[1]).totalGeometries()),

						extraTrack: Number(defined(phases[2]).totalGeometries()),

						bridge: Number(defined(phases[3]).totalGeometries()),
					};
					const result = searchGridCrossingAllocations(
						input,
						(allocation) => ({
							candidate: allocation,
							failure: regionGeometryDiagnostic(
								RegionGeometryDiagnosticCode.GridCrossingEntersElement,
								'A declared obstacle blocks every candidate.',
							),
						}),
						budgets,
						GridCrossingSearchMode.Exhaustive,
					);
					expect('failure' in result).toBe(true);
					for (const phase of result.witness.phases) {
						expect(phase.exhaustive).toBe(true);
						expect(BigInt(phase.exploredGeometries)).toBe(BigInt(phase.totalGeometries));
					}
					const reversed = gridCrossingResources(
						{
							...fixture.gridInput,
							cells: [...fixture.gridInput.cells].reverse(),
							cellByEndpointId: new Map([...fixture.gridInput.cellByEndpointId].reverse()),
						},
						[...fixture.crossing].reverse(),
					);
					expect(reversed.rowGutterIds).toEqual(
						resources.rowGutterIds.map((ids) => [...ids].reverse()),
					);
					expect(reversed.edges.rowGutters).toEqual(resources.edges.rowGutters);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
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
					const rowGutter = [...defined(phases[0]).candidates()];
					const reallocation = [...defined(phases[1]).candidates()];
					const extraTrack = [...defined(phases[2]).candidates()];
					const bridge = [...defined(phases[3]).candidates()];
					expect(reallocation[0]).toEqual(
						routedPortAllocation(input, canonicalCrossingAllocation(input)),
					);
					for (const [phaseIndex, candidates] of [
						rowGutter,
						reallocation,
						extraTrack,
						bridge,
					].entries()) {
						const phase = defined(phases[phaseIndex]);
						const geometries = candidates.map((allocation) =>
							effectiveRouteGeometry(routing, crossing, allocation),
						);
						expect(new Set(geometries).size).toBe(candidates.length);
						expect(BigInt(new Set(geometries).size)).toBe(phase.totalGeometries());
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
	it('enumerates every small route assignment independently and preserves a manual valid path', () => {
		for (const crossingCount of [1, 2]) {
			for (const sameRail of [false, true]) {
				const fixture = variedGridRoutingCase(crossingCount, 2, 0, sameRail);
				const phases = crossingAllocationPhases(fixture.input);
				for (const [index, extraTrack] of [false, true, false].entries()) {
					const expected = naiveAllocationSignatures(fixture.input, extraTrack);
					const actual = new Set(
						defined(phases[index + 1])
							.candidates()
							.map((allocation) => allocationSignature(fixture.input, allocation)),
					);
					expect(actual).toEqual(expected);
				}
			}
		}
		const oneRoute = variedGridRoutingCase(1, 2, 0, true);
		const allocation = canonicalCrossingAllocation(oneRoute.input);
		const path = defined(crossingRoutes(oneRoute.routing, allocation)[0]).route;
		// Source and target remain in the first column; the path stays on its left rail.
		expect(path.points).toEqual([
			{ x: 180, y: 188 },
			{ x: 100, y: 188 },
			{ x: 52, y: 188 },
			{ x: 52, y: 588 },
			{ x: 100, y: 588 },
			{ x: 180, y: 588 },
		]);
		const foreignCells = oneRoute.routing.cells.filter(
			({ id }) => id !== 'cell-0-0' && id !== 'cell-1-0',
		);
		for (const foreign of foreignCells)
			expect(path.points.every(({ x }) => x < foreign.bounds.x)).toBe(true);
		expect(routeGridFixture(oneRoute, allocation, false).failure).toBeUndefined();
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
						const candidates = [...phase.candidates(active, true)];
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

	it('compares conflict-first pruning with unpruned search on generated crossing routes', () => {
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
						rowGutter: Number(defined(phases[0]).totalGeometries()),

						reallocate: Number(defined(phases[1]).totalGeometries()),

						extraTrack: Number(defined(phases[2]).totalGeometries()),

						bridge: Number(defined(phases[3]).totalGeometries()),
					};
					const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) =>
						routeGridFixture(fixture, allocation, acceptBridges);
					const unpruned = searchGridCrossingAllocations(
						input,
						route,
						budgets,
						GridCrossingSearchMode.Exhaustive,
					);
					const pruned = searchGridCrossingAllocations(input, route, budgets);
					if ('selected' in unpruned) {
						expect('selected' in pruned).toBe(true);
						if (!('selected' in pruned)) return;
						const order = Object.values(CrossingAllocationPhaseId);
						expect(order.indexOf(pruned.witness.winningPhase)).toBeLessThanOrEqual(
							order.indexOf(unpruned.witness.winningPhase),
						);
						const acceptsBridges = pruned.witness.winningPhase === CrossingAllocationPhaseId.Bridge;
						expect(route(pruned.selected.allocation, acceptsBridges).failure).toBeUndefined();
						const firstBusBlock = crossingCanonicalBusGeometryCount(input);
						if (
							firstBusBlock <= BigInt(GRID_CROSSING_REALLOCATION_BUDGET) &&
							pruned.witness.winningPhase === CrossingAllocationPhaseId.Reallocate &&
							pruned.witness.winningPhase === unpruned.witness.winningPhase
						)
							expect(pruned.selected.candidate.layout).toEqual(unpruned.selected.candidate.layout);
					} else if (unpruned.witness.exhaustive) {
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
				const { input, routing } = variedGridRoutingCase(1, 2, 0);
				const sourceCell = defined(routing.cells.find(({ id }) => id === 'cell-0-0'));
				const obstacle = {
					x: sourceCell.bounds.x + 20,
					y: sourceCell.bounds.y,
					width: obstacleWidth,
					height: sourceCell.bounds.height,
				};
				const route = (allocation: GridCrossingAllocation) => {
					const path = defined(crossingRoutes(routing, allocation)[0]).route;
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
					rowGutter: Number(defined(phases[0]).totalGeometries()),
					reallocate: Number(defined(phases[1]).totalGeometries()),
					extraTrack: Number(defined(phases[2]).totalGeometries()),
					bridge: Number(defined(phases[3]).totalGeometries()),
				};
				const unpruned = searchGridCrossingAllocations(
					input,
					route,
					budgets,
					GridCrossingSearchMode.Exhaustive,
				);
				const pruned = searchGridCrossingAllocations(input, route);
				expect('failure' in unpruned).toBe(true);
				expect(unpruned.witness.exhaustive).toBe(true);
				expect('failure' in pruned).toBe(true);
				expect(pruned.witness.exhaustive).toBe(true);
			}),
			PROPERTY_PARAMETERS,
		);
	});
	it('keeps bounded phase results valid when later conflict diagnostics remain unseen', () => {
		const fixture = variedGridRoutingCase(3, 2, 2);
		const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) =>
			routeGridFixture(fixture, allocation, acceptBridges);
		const unpruned = searchGridCrossingAllocations(
			fixture.input,
			route,
			undefined,
			GridCrossingSearchMode.Exhaustive,
		);
		const result = searchGridCrossingAllocations(fixture.input, route);
		expect('selected' in unpruned).toBe(true);
		const first = result.witness.rejectedAlternatives[0];
		expect(first?.reason).toContain('route-0 and route-1');
		expect(Number(defined(result.witness.phases[1]).totalGeometries)).toBeGreaterThan(256);
		expect(defined(result.witness.phases[1]).exploredGeometries).toBe(256);
		if (!('selected' in result)) throw new Error('Later phases must find a validated bridge.');
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		if (!('selected' in unpruned)) throw new Error('The canonical budgeted search must select.');
		expect(unpruned.witness.winningPhase).toBe(CrossingAllocationPhaseId.Bridge);
		expect(unpruned.witness.phases[2]?.exploredGeometries).toBe(256);
		expect(route(result.selected.allocation, true).failure).toBeUndefined();
		expect(route(unpruned.selected.allocation, true).failure).toBeUndefined();
	});
});
