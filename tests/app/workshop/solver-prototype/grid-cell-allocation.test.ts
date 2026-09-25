import { describe, expect, it } from 'vitest';

import { gridCrossingAllocationDemos } from '../../../../src/app/workshop/solver-prototype/grid-cell-allocation';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grid-cell-crossing-phases';

describe('grid crossing allocation workshop model', () => {
	it('runs production grid allocations and records phase budgets and selected tracks', () => {
		const demos = gridCrossingAllocationDemos();
		expect(demos.map(({ id }) => id)).toEqual([
			'grid-allocation-2x2',
			'grid-allocation-3x2-truncated',
			'grid-allocation-noncanonical-bus',
		]);
		expect(demos.map(({ winningPhase }) => winningPhase)).toEqual([
			CrossingAllocationPhaseId.Reallocate,
			CrossingAllocationPhaseId.Bridge,
			CrossingAllocationPhaseId.Reallocate,
		]);

		const [basic, truncated, noncanonical] = demos;
		if (basic === undefined || truncated === undefined || noncanonical === undefined)
			throw new Error('Expected the three grid allocation demos.');
		expect(basic.selected.cells).toHaveLength(4);
		expect(truncated.selected.cells).toHaveLength(6);
		expect(truncated.selected.witness.phases.slice(0, 2).map(({ truncated: cut }) => cut)).toEqual([
			true,
			true,
		]);
		expect(truncated.selected.witness.phases[2]).toMatchObject({
			id: CrossingAllocationPhaseId.Bridge,
			attempted: true,
			selected: true,
		});
		expect(noncanonical.busOrder).toEqual(['a-b', 'a-d', 'a-c']);
		for (const demo of demos) {
			expect(demo.tracks).toHaveLength(demo.selected.layout.relations.length);
			for (const route of demo.selected.layout.relations)
				expect(demo.colorsByRelationId.get(route.id)).toBeDefined();
		}
	});
});
