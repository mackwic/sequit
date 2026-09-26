import { describe, expect, it } from 'vitest';

import {
	compareSharedLanePassages,
	PassageCandidateId,
} from '../../../../../src/app/workshop/visual-tests/solver-prototype/shared-lane-passage-witness';
import { createGraph } from '../../../../../src/lib/core/graph/create-graph';
import { SHARED_LANE_CLEARANCE } from '../../../../../src/lib/core/layout/lanes/shared-lane-frame';
import { validateSharedLaneGeometry } from '../../../../../src/lib/core/layout/lanes/shared-lane-geometry';
import { validateSharedLaneInteriorPassage } from '../../../../../src/lib/core/layout/lanes/shared-lane-interior-validation';

describe('S | SD | C passage comparison', () => {
	it('uses one real document, one measurement set and an identical frame for two valid routes', () => {
		const comparison = compareSharedLanePassages();
		const built = createGraph(comparison.document);
		if (!built.ok) throw new Error('Expected a valid workshop graph.');
		const graph = built.value;
		expect(comparison.document.relations).toEqual([
			{ id: 'request', from: 'c-request', to: 's-receive' },
		]);
		expect(comparison.document.groups.map(({ id }) => id)).toEqual(['sd-block']);
		expect(comparison.document.nodes.every(({ groupId }) => groupId === undefined)).toBe(true);
		expect(comparison.measurements.nodes.get('c-request')).toEqual({ width: 220, height: 116 });
		expect(comparison.measurements.groups.get('sd-block')).toMatchObject({
			minimumWidth: 220,
			minimumHeight: 180,
		});
		const [exterior, interior] = comparison.panels;
		expect([exterior.id, interior.id]).toEqual([
			PassageCandidateId.Exterior,
			PassageCandidateId.Interior,
		]);
		for (const candidate of comparison.panels) {
			expect(
				validateSharedLaneGeometry(graph, candidate.geometry, SHARED_LANE_CLEARANCE),
			).toBeUndefined();
			expect(candidate.geometry.relations).toHaveLength(1);
			expect(candidate.routeLength).toBeGreaterThan(0);
			expect(candidate.bends).toBeGreaterThan(0);
			expect(candidate.middleCrossingY).toBeGreaterThan(0);
		}
		expect(exterior.geometry.lanes).toEqual(interior.geometry.lanes);
		expect(exterior.geometry.elements).toEqual(interior.geometry.elements);
		expect(exterior.geometry.width).toBe(interior.geometry.width);
		expect(exterior.geometry.height).toBe(interior.geometry.height);
		expect(exterior.geometry.relations).not.toEqual(interior.geometry.relations);
		expect(comparison.fullViewBox).toBe(
			`0 0 ${exterior.geometry.width} ${exterior.geometry.height}`,
		);
		expect(comparison.focusViewBox).not.toBe(comparison.fullViewBox);
	});

	it('retains the exterior as admissible while preferring the monotone interior passage', () => {
		const comparison = compareSharedLanePassages();
		const built = createGraph(comparison.document);
		if (!built.ok) throw new Error('Expected a valid workshop graph.');
		const [exterior, interior] = comparison.panels;
		expect(exterior.preferred).toBe(false);
		expect(interior.preferred).toBe(true);
		expect(exterior.monotone).toBe(false);
		expect(interior.monotone).toBe(true);
		expect(validateSharedLaneInteriorPassage(built.value, exterior.geometry, 'request')).toContain(
			'does not progress monotonically',
		);
		expect(
			validateSharedLaneInteriorPassage(built.value, interior.geometry, 'request'),
		).toBeUndefined();
		const route = interior.geometry.relations[0];
		if (route === undefined) throw new Error('Expected the interior route.');
		const sourceY = route.points[0]?.y;
		const targetY = route.points.at(-1)?.y;
		if (sourceY === undefined || targetY === undefined) throw new Error('Expected route ports.');
		expect(interior.middleCrossingY).toBeLessThan(sourceY);
		expect(interior.middleCrossingY).toBeGreaterThan(targetY);
		expect(exterior.middleCrossingY).toBeGreaterThan(sourceY);
	});
});
