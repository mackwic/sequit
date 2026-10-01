import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined, LaneOrientation } from '../../../../src/lib/core/document/logic-document';
import {
	SharedLaneLayoutStatus,
	solveSharedLaneLayout,
} from '../../../../src/lib/core/layout/lanes/shared-lane-layout';
import type { Bounds, Point } from '../../../../src/lib/core/layout/layout-types';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import {
	contains,
	prepareLayoutDocument,
	progressesFromTo,
} from '../../../support/harnesses/layout';
import {
	LANE_ROW_DIRECTIONS,
	LANE_ROW_ORIENTATIONS,
	laneRowsDocument,
	type LaneRowsSpec,
} from './shared-lane-rows-fixture';

const LANE_IDS = ['A', 'B', 'C'] as const;

/** Two or three lanes, up to six tasks and four child → parent relations, in every configuration. */
const laneCases: fc.Arbitrary<LaneRowsSpec> = fc
	.record({
		laneCount: fc.integer({ min: 2, max: 3 }),
		nodeCount: fc.integer({ min: 2, max: 6 }),
		direction: fc.constantFrom(...LANE_ROW_DIRECTIONS),
		orientation: fc.constantFrom(...LANE_ROW_ORIENTATIONS),
	})
	.chain(({ laneCount, nodeCount, direction, orientation }) => {
		const lanes = LANE_IDS.slice(0, laneCount);
		const ids = Array.from({ length: nodeCount }, (_, index) => `n${index}`);
		const pairs: (readonly [string, string])[] = [];
		for (let child = 1; child < nodeCount; child += 1)
			for (let parent = 0; parent < child; parent += 1)
				pairs.push([defined(ids[child]), defined(ids[parent])]);
		return fc.record({
			direction: fc.constant(direction),
			orientation: fc.constant(orientation),
			lanes: fc.constant(lanes),
			nodes: fc
				.array(fc.constantFrom(...lanes), { minLength: nodeCount, maxLength: nodeCount })
				.map((assigned) => assigned.map((lane, index) => [defined(ids[index]), lane] as const)),
			relations: fc.subarray(pairs, { maxLength: Math.min(4, pairs.length) }),
		});
	});

/** Whether an orthogonal segment enters the open interior of a box. */
function entersBox(start: Point, end: Point, bounds: Bounds): boolean {
	const acrossX =
		Math.min(start.x, end.x) < bounds.x + bounds.width && Math.max(start.x, end.x) > bounds.x;
	const acrossY =
		Math.min(start.y, end.y) < bounds.y + bounds.height && Math.max(start.y, end.y) > bounds.y;
	return acrossX && acrossY;
}

describe('shared lane rows property', () => {
	it('keeps parents before children, every box in its lane and every route off foreign boxes', () => {
		fc.assert(
			fc.property(laneCases, (spec) => {
				const prepared = prepareLayoutDocument(laneRowsDocument(spec));
				const result = solveSharedLaneLayout(prepared.graph, prepared.ranks, prepared.measurements);
				expect(result.status, JSON.stringify(result)).toBe(SharedLaneLayoutStatus.Selected);
				if (result.status !== SharedLaneLayoutStatus.Selected) return;
				const bounds = new Map(result.layout.elements.map(({ id, bounds }) => [id, bounds]));
				const laneOf = new Map(spec.nodes);
				for (const [id, laneId] of spec.nodes) {
					const lane = defined(result.layout.lanes?.find((candidate) => candidate.id === laneId));
					expect(contains(lane.bounds, defined(bounds.get(id))), id).toBe(true);
				}
				// Parallel rows span every lane; transverse lanes keep their order, so only a parent in
				// the child's lane or in an earlier lane can precede it along the rank axis.
				for (const [child, parent] of spec.relations) {
					const childLane = spec.lanes.indexOf(defined(laneOf.get(child)));
					const parentLane = spec.lanes.indexOf(defined(laneOf.get(parent)));
					if (spec.orientation === LaneOrientation.Transverse && parentLane > childLane) continue;
					const progresses = progressesFromTo(
						defined(bounds.get(parent)),
						defined(bounds.get(child)),
						spec.direction[0],
					);
					expect(progresses, `${child} → ${parent}`).toBe(true);
				}
				for (const route of result.layout.relations) {
					const last = route.points.length - 1;
					for (let index = 1; index <= last; index += 1) {
						const start = defined(route.points[index - 1]);
						const end = defined(route.points[index]);
						for (const [id, box] of bounds) {
							const ownStub =
								(id === route.from && index === 1) || (id === route.to && index === last);
							if (!ownStub) expect(entersBox(start, end, box), `${route.id} × ${id}`).toBe(false);
						}
					}
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
