import { describe, expect, it } from 'vitest';

import { gridCrossingAllocationDemos } from '../../../../src/app/workshop/solver-prototype/grid-cell-allocation';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';

describe('grid crossing allocation workshop model', () => {
	it('runs production grid allocations and records phase budgets and selected tracks', () => {
		const demos = gridCrossingAllocationDemos();
		expect(demos.map(({ id }) => id)).toEqual([
			'grid-allocation-2x2',
			'grid-allocation-3x2-conflicts-first',
			'grid-allocation-row-gutter',
		]);
		// Since G-02, a-b and c-f of the three by two demo cross their neighbour gaps: the first
		// row-gutter candidate is valid and no reallocation is needed any more.
		expect(demos.map(({ winningPhase }) => winningPhase)).toEqual([
			CrossingAllocationPhaseId.RowGutter,
			CrossingAllocationPhaseId.RowGutter,
			CrossingAllocationPhaseId.RowGutter,
		]);

		const [basic, pruned, horizontal] = demos;
		if (basic === undefined || pruned === undefined || horizontal === undefined)
			throw new Error('Expected the three grid allocation demos.');
		expect(basic.selected.cells).toHaveLength(4);
		expect(pruned.selected.cells).toHaveLength(6);
		expect(pruned.sizeBefore.width - pruned.selected.layout.width).toBe(96);
		expect(pruned.sizeBefore.height - pruned.selected.layout.height).toBe(48);
		expect(pruned.selected.witness.phases[0]).toMatchObject({
			id: CrossingAllocationPhaseId.RowGutter,
			exploredGeometries: 1,
			totalGeometries: '16',
			selected: true,
		});
		expect(pruned.selected.witness.phases.slice(1).map(({ attempted }) => attempted)).toEqual([
			false,
			false,
			false,
		]);
		expect(
			pruned.selected.portals
				.filter(({ relationId }) => relationId !== 'a-c')
				.map(({ relationId, side }) => [relationId, side]),
		).toEqual([
			['a-b', RegionPortalSide.Right],
			['a-b', RegionPortalSide.Left],
			['c-f', RegionPortalSide.Bottom],
			['c-f', RegionPortalSide.Top],
		]);
		expect(basic.busOrder).toEqual([]);
		expect(basic.tracks[0]?.routeTrackLabel).toBe('gouttière R1·0');
		expect(horizontal.busOrder).toEqual(['a-b', 'a-c']);
		// From the inside out: a-d leaves by the row gutter, a-b turns back in its column, a-c crosses
		// over the top bus on the bus track nearest the grid.
		expect(horizontal.tracks).toEqual([
			{ relationId: 'a-b', color: '#bf4f36', routeTrackLabel: 'bus 0', railLabel: 'G1·1' },
			{ relationId: 'a-c', color: '#287b65', routeTrackLabel: 'bus 2', railLabel: 'G1·2 / G3·1' },
			{
				relationId: 'a-d',
				color: '#4c5fb5',
				routeTrackLabel: 'gouttière R1·0',
				railLabel: 'G1·0 / G3·0',
			},
		]);
	});
});
