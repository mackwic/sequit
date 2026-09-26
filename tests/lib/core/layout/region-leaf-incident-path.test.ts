import { describe, expect, it } from 'vitest';

import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import { regionLeafIncidentPath } from '../../../../src/lib/core/layout/regions/leaf/region-leaf-incident-path';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionIncidentRole } from '../../../../src/lib/core/layout/regions/model/region-incident-contract';

const layout: LayoutResult = {
	width: 160,
	height: 100,
	elements: [],
	relations: [],
};

describe('solved leaf incident frame', () => {
	it('keeps the historical direct source segment byte-for-byte on the upper frame', () => {
		const path = regionLeafIncidentPath('leaf', layout, {
			relationId: 'out',
			endpointId: 'a',
			role: RegionIncidentRole.Source,
			side: RegionPortalSide.Top,
			anchor: { x: 45, y: 20 },
			portal: { x: 45, y: 0 },
			points: [
				{ x: 45, y: 20 },
				{ x: 45, y: 0 },
			],
		});
		expect(path.pieces).toEqual([
			{
				relationId: 'out',
				regionId: 'leaf',
				points: [
					{ x: 45, y: 20 },
					{ x: 45, y: -32 },
				],
			},
		]);
		expect(path.portals[0]?.localPoint).toEqual({ x: 77, y: 0 });
	});

	it('reverses a right-side target path into relation direction', () => {
		const path = regionLeafIncidentPath('leaf', layout, {
			relationId: 'in',
			endpointId: 'b',
			role: RegionIncidentRole.Target,
			side: RegionPortalSide.Right,
			anchor: { x: 120, y: 48 },
			portal: { x: 160, y: 48 },
			points: [
				{ x: 120, y: 48 },
				{ x: 160, y: 48 },
			],
		});
		expect(path.pieces[0]?.points).toEqual([
			{ x: 192, y: 48 },
			{ x: 120, y: 48 },
		]);
		expect(path.portals[0]?.localPoint).toEqual({ x: 224, y: 80 });
	});

	it('keeps the final bend when extending a right-side route to its frame', () => {
		const path = regionLeafIncidentPath('leaf', layout, {
			relationId: 'bent',
			endpointId: 'a',
			role: RegionIncidentRole.Source,
			side: RegionPortalSide.Right,
			anchor: { x: 120, y: 30 },
			portal: { x: 160, y: 48 },
			points: [
				{ x: 120, y: 30 },
				{ x: 160, y: 30 },
				{ x: 160, y: 48 },
			],
		});
		expect(path.pieces[0]?.points).toEqual([
			{ x: 120, y: 30 },
			{ x: 160, y: 30 },
			{ x: 160, y: 48 },
			{ x: 192, y: 48 },
		]);
	});
});
