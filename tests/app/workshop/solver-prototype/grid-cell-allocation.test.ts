import { describe, expect, it } from 'vitest';

import { gridCrossingAllocationDemos } from '../../../../src/app/workshop/solver-prototype/grid-cell-allocation';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grid-cell-crossing-phases';

describe('grid crossing allocation workshop model', () => {
	it('runs production grid allocations and records phase budgets and selected tracks', () => {
		const demos = gridCrossingAllocationDemos();
		expect(demos.map(({ id }) => id)).toEqual([
			'grid-allocation-2x2',
			'grid-allocation-3x2-conflicts-first',
			'grid-allocation-noncanonical-bus',
		]);
		expect(demos.map(({ winningPhase }) => winningPhase)).toEqual([
			CrossingAllocationPhaseId.Reallocate,
			CrossingAllocationPhaseId.Reallocate,
			CrossingAllocationPhaseId.Reallocate,
		]);

		const [basic, pruned, noncanonical] = demos;
		if (basic === undefined || pruned === undefined || noncanonical === undefined)
			throw new Error('Expected the three grid allocation demos.');
		expect(basic.selected.cells).toHaveLength(4);
		expect(basic.selected.witness.phases[0]).toMatchObject({
			exploredGeometries: 1,
			totalGeometries: '1',
			exhaustive: true,
			selected: true,
		});
		expect(basic.selected.witness.phases.slice(1).map(({ attempted }) => attempted)).toEqual([
			false,
			false,
		]);
		expect(pruned.selected.cells).toHaveLength(6);
		expect(pruned.sizeBefore.width - pruned.selected.layout.width).toBe(96);
		expect(pruned.sizeBefore.height - pruned.selected.layout.height).toBe(48);
		expect(pruned.selected.witness.phases[0]).toMatchObject({
			id: CrossingAllocationPhaseId.Reallocate,
			exploredGeometries: 33,
			totalGeometries: '96',
			truncated: false,
			selected: true,
		});
		expect(pruned.selected.witness.phases.slice(1).map(({ attempted }) => attempted)).toEqual([
			false,
			false,
		]);
		expect(noncanonical.busOrder).toEqual(['a-b', 'a-d', 'a-c']);
		expect(noncanonical.tracks).toEqual([
			{ relationId: 'a-b', color: '#bf4f36', busTrack: 0, railLabel: 'G1·0' },
			{ relationId: 'a-c', color: '#287b65', busTrack: 2, railLabel: 'G1·1 / G3·0' },
			{ relationId: 'a-d', color: '#4c5fb5', busTrack: 1, railLabel: 'G1·2 / G3·1' },
		]);
	});
});
