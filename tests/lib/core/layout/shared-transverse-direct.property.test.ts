import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined, LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import {
	cross,
	crossEnd,
	crossStart,
} from '../../../../src/lib/core/layout/geometry/shared-lane-geometry-primitives';
import { validateSharedLaneGeometry } from '../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import { verticalDirection } from '../../../../src/lib/core/layout/lanes/shared-lane-model';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	LANE_ROW_DIRECTIONS,
	laneRowsDocument,
	type LaneRowsSpec,
} from './shared-lane-rows-fixture';

const LANE_IDS = ['A', 'B', 'C'] as const;

/**
 * Two or three transverse lanes, up to six tasks, and a single relation between two adjacent lanes,
 * in either direction: nothing else competes for the faces the two endpoints turn to each other.
 */
const adjacentCases: fc.Arbitrary<LaneRowsSpec> = fc
	.record({
		laneCount: fc.integer({ min: 2, max: 3 }),
		nodeCount: fc.integer({ min: 2, max: 6 }),
		direction: fc.constantFrom(...LANE_ROW_DIRECTIONS),
	})
	.chain(({ laneCount, nodeCount, direction }) => {
		const lanes = LANE_IDS.slice(0, laneCount);
		const ids = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
		return fc
			.record({
				assigned: fc.array(fc.constantFrom(...lanes), {
					minLength: nodeCount,
					maxLength: nodeCount,
				}),
				ends: fc.uniqueArray(fc.integer({ min: 0, max: nodeCount - 1 }), {
					minLength: 2,
					maxLength: 2,
				}),
				lowerLane: fc.integer({ min: 0, max: laneCount - 2 }),
				downward: fc.boolean(),
			})
			.map(({ assigned, ends, lowerLane, downward }) => {
				const [from, to] = ends.map((index) => defined(ids[index]));
				let sourceLane = defined(lanes[lowerLane + 1]);
				let targetLane = defined(lanes[lowerLane]);
				if (downward) [sourceLane, targetLane] = [targetLane, sourceLane];
				const nodes = ids.map((id, index) => {
					if (id === from) return [id, sourceLane] as const;
					if (id === to) return [id, targetLane] as const;
					return [id, defined(assigned[index])] as const;
				});
				return {
					direction,
					orientation: LaneOrientation.Transverse,
					lanes,
					nodes,
					relations: [[defined(from), defined(to)] as const],
				};
			});
	});

describe('transverse direct route property', () => {
	it('joins adjacent lanes by a monotone route between their facing faces, never by the gutter', () => {
		fc.assert(
			fc.property(adjacentCases, (spec) => {
				const prepared = prepareLayoutDocument(laneRowsDocument(spec));
				const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
				expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
				if (result.status !== SharedLaneLayoutStatus.Selected) return;
				expect(validateSharedLaneGeometry(prepared.graph, result.geometry)).toBeUndefined();
				const route = defined(result.layout.relations[0]);
				// A segment, or two bends inside the free interval between the lanes.
				expect(route.points.length).toBeLessThanOrEqual(4);
				const start = defined(route.points[0]);
				const end = defined(route.points.at(-1));
				let length = 0;
				for (let index = 1; index < route.points.length; index += 1) {
					const previous = defined(route.points[index - 1]);
					const current = defined(route.points[index]);
					length += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
				}
				expect(length).toBe(Math.abs(end.x - start.x) + Math.abs(end.y - start.y));
				// The gutter corridor lies outside the lanes' common cross extent.
				const lane = defined(result.layout.lanes?.[0]).bounds;
				const vertical = verticalDirection(spec.direction[0]);
				for (const point of route.points) {
					expect(cross(point, vertical)).toBeGreaterThanOrEqual(crossStart(lane, vertical));
					expect(cross(point, vertical)).toBeLessThanOrEqual(crossEnd(lane, vertical));
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
