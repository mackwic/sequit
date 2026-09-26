import { describe, expect, it } from 'vitest';

import { boundaryPortal } from '../../../../src/lib/core/layout/regions/model/nested-region-recursive-geometry';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';

describe('recursive region boundary portals', () => {
	it.each([
		[RegionPortalSide.Top, { x: 67, y: -32 }, { x: 99, y: 0 }],
		[RegionPortalSide.Right, { x: 192, y: 43 }, { x: 224, y: 75 }],
		[RegionPortalSide.Bottom, { x: 67, y: 132 }, { x: 99, y: 164 }],
		[RegionPortalSide.Left, { x: -32, y: 43 }, { x: 0, y: 75 }],
	])('publishes a %s portal on the padded region frame', (side, point, localPoint) => {
		const portal = boundaryPortal({
			relationId: 'crossing',
			endpointId: 'node',
			regionId: 'leaf',
			side,
			x: 67,
			y: 43,
			canvasWidth: 160,
			canvasHeight: 100,
		});
		expect(portal.point).toEqual(point);
		expect(portal.localPoint).toEqual(localPoint);
		expect({ x: portal.point.x + 32, y: portal.point.y + 32 }).toEqual(localPoint);
	});
});
