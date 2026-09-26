import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { canonicalCrossingAllocation } from '../../../../src/lib/core/layout/grid-cell-crossing-allocation';
import { crossingAllocationPhases } from '../../../../src/lib/core/layout/grid-cell-crossing-phases';
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
					seed: fc.integer({ min: 0, max: 5 }),
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
});
