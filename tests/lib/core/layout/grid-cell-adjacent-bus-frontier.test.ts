import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import {
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import type { GridCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { searchGridCrossingAllocations } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-search';
import { variedGridRoutingCase } from './grid-cell-crossing-allocation-fixture';

describe('grid crossing bus conflict frontier', () => {
	it('moves a bus-neighbor route after an element-entry conflict', () => {
		const fixture = variedGridRoutingCase(3, 2, 2);
		let blocked: GridCrossingAllocation | undefined;
		let adjacentIds: readonly string[] = [];
		let attempts = 0;
		const result = searchGridCrossingAllocations(
			fixture.input,
			(allocation) => {
				attempts += 1;
				if (attempts === 1)
					return {
						candidate: allocation,
						failure: regionGeometryDiagnostic(
							RegionGeometryDiagnosticCode.ParentRouteContact,
							'Initial row-gutter candidate is blocked.',
							{ relationId: 'route-0', relatedRelationId: 'route-1' },
						),
					};
				if (attempts === 2) {
					blocked = allocation;
					const track = defined(allocation.busTrackByRelationId.get('route-0'));
					adjacentIds = fixture.input.crossingIds.filter(
						(id) =>
							id !== 'route-0' &&
							Math.abs(defined(allocation.busTrackByRelationId.get(id)) - track) === 1,
					);
					return {
						candidate: allocation,
						failure: regionGeometryDiagnostic(
							RegionGeometryDiagnosticCode.GridCrossingEntersElement,
							'Route is blocked on the top bus.',
							{ relationId: 'route-0', endpointId: 'source-shared' },
						),
					};
				}
				const baseline = defined(blocked);
				const routeMoved =
					allocation.busTrackByRelationId.get('route-0') !==
					baseline.busTrackByRelationId.get('route-0');
				const neighborMoved = adjacentIds.some(
					(id) => allocation.busTrackByRelationId.get(id) !== baseline.busTrackByRelationId.get(id),
				);
				if (routeMoved && neighborMoved) return { candidate: allocation };
				return {
					candidate: allocation,
					failure: regionGeometryDiagnostic(
						RegionGeometryDiagnosticCode.GridCrossingEntersElement,
						'Route remains blocked on the top bus.',
						{ relationId: 'route-0', endpointId: 'source-shared' },
					),
				};
			},
			{ rowGutter: 1, reallocate: 2, extraTrack: 1, bridge: 1 },
		);
		if (!('selected' in result))
			throw new Error('The adjacent-bus priority candidate must be selected.');
		const baseline = defined(blocked);
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Reallocate);
		expect(adjacentIds.length).toBeGreaterThan(0);
		expect(result.selected.allocation.busTrackByRelationId.get('route-0')).not.toBe(
			baseline.busTrackByRelationId.get('route-0'),
		);
		expect(
			adjacentIds.some(
				(id) =>
					result.selected.allocation.busTrackByRelationId.get(id) !==
					baseline.busTrackByRelationId.get(id),
			),
		).toBe(true);
	});
});
