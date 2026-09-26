import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { unbridgedContacts } from '../../../../src/lib/core/layout/bridge-contact';
import { validatedBridges } from '../../../../src/lib/core/layout/bridge-oracle';
import { crossingOverlap } from '../../../../src/lib/core/layout/grid-cell-crossing';
import {
	canonicalCrossingAllocation,
	type GridCrossingAllocation,
} from '../../../../src/lib/core/layout/grid-cell-crossing-allocation';
import {
	CrossingAllocationPhaseId,
	crossingAllocationPhases,
} from '../../../../src/lib/core/layout/grid-cell-crossing-phases';
import { crossingRoute } from '../../../../src/lib/core/layout/grid-cell-crossing-routing';
import {
	GridCrossingSearchMode,
	searchGridCrossingAllocations,
} from '../../../../src/lib/core/layout/grid-cell-crossing-search';
import { entersInterior } from '../../../../src/lib/core/layout/grid-cell-geometry-primitives';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/region-geometry-diagnostic';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	effectiveRouteGeometry,
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
					const { input, routing, crossing } = variedGridRoutingCase(
						crossingCount,
						columnCount,
						seed,
						sameRail,
					);
					const phases = crossingAllocationPhases(input);
					const budgets = {
						reallocate: Number(defined(phases[0]).totalGeometries(input)),
						extraTrack: Number(defined(phases[1]).totalGeometries(input)),
						bridge: Number(defined(phases[2]).totalGeometries(input)),
					};
					const route = (allocation: GridCrossingAllocation, acceptBridges: boolean) => {
						const paths = crossing.map(
							(relation) => crossingRoute(routing, allocation, relation).route,
						);
						const overlap = crossingOverlap(paths);
						if (overlap !== undefined)
							return {
								candidate: paths,
								failure: regionGeometryDiagnostic(
									RegionGeometryDiagnosticCode.GridCrossingOverlap,
									overlap.message,
									{ relationId: overlap.firstId, relatedRelationId: overlap.secondId },
								),
							};
						let bridges: ReturnType<typeof validatedBridges> = [];
						if (acceptBridges) bridges = validatedBridges(paths);
						for (const [index, first] of paths.entries()) {
							for (const second of paths.slice(index + 1)) {
								if (unbridgedContacts(first, second, bridges).length > 0)
									return {
										candidate: paths,
										failure: regionGeometryDiagnostic(
											RegionGeometryDiagnosticCode.ParentRouteContact,
											'Unbridged route contact.',
											{ relationId: first.id, relatedRelationId: second.id },
										),
									};
							}
						}
						return { candidate: paths };
					};
					const oracle = searchGridCrossingAllocations(
						input,
						route,
						budgets,
						GridCrossingSearchMode.Exhaustive,
					);
					const pruned = searchGridCrossingAllocations(input, route);
					if ('selected' in oracle) {
						expect('selected' in pruned).toBe(true);
						if (!('selected' in pruned)) return;
						const order = Object.values(CrossingAllocationPhaseId);
						expect(order.indexOf(pruned.witness.winningPhase)).toBeLessThanOrEqual(
							order.indexOf(oracle.witness.winningPhase),
						);
						if (pruned.witness.winningPhase === oracle.witness.winningPhase)
							expect(pruned.selected.candidate).toEqual(oracle.selected.candidate);
					} else if (oracle.witness.exhaustive) {
						expect('selected' in pruned).toBe(false);
					}
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
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
});
