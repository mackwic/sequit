import type { RoutingEdge } from '../geometry/routing-edge';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';

function faceExtent(bounds: Bounds, side: RegionPortalSide): number {
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Right) return bounds.height;
	return bounds.width;
}

/**
 * The port edge of one lane-leaf face: the face publishes one track per `PORT_SPACING` slot between
 * its two insets, and two ports closer than that spacing share a track. The size demand of the face
 * (`faceDemand`) is what grows the face until it publishes the tracks its ports request.
 */
export function facePortEdge(
	endpointId: string,
	side: RegionPortalSide,
	bounds: Bounds,
): RoutingEdge {
	const extent = faceExtent(bounds, side);
	const slots = (extent - 2 * PORT_INSET) / PORT_SPACING;
	return {
		ownerId: `${endpointId}/${side}`,
		capacity: Math.floor(slots) + 1,
		spacing: PORT_SPACING,
	};
}

/** The face extent `count` ordered ports need, beside `reserved` incident ports of the same face. */
export function faceDemand(count: number, reserved: number): number {
	if (reserved === 0) {
		const spread = (count - 1) * PORT_SPACING;
		return 2 * PORT_INSET + spread;
	}
	const furthestPort = Math.max(count, reserved - 1) * PORT_SPACING;
	return 2 * (PORT_INSET + furthestPort);
}

/**
 * Offset from the face centre of the port at `index` among `count` ordered ports: centred on a free
 * face, before the centre when incident ports hold the centre and after.
 */
export function facePortOffset(index: number, count: number, reserved: number): number {
	if (reserved > 0) return (index - count) * PORT_SPACING;
	const centre = (count - 1) / 2;
	return (index - centre) * PORT_SPACING;
}
