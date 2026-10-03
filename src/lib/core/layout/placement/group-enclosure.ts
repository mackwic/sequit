import { envelopeOf } from '../geometry/envelope';
import { type MutableBounds, translateTransversely } from '../geometry/layout-frame';
import type { GroupMeasurement } from '../layout-types';

/** A frame around its members: padding, header on the physical top, then minimum sizes. */
export function enclosure(
	measurement: GroupMeasurement,
	members: readonly string[],
	bounds: ReadonlyMap<string, MutableBounds>,
): MutableBounds {
	const envelope = envelopeOf(members, bounds);
	const x = envelope.left - measurement.padding;
	const y = envelope.top - measurement.headerHeight - measurement.padding;
	return {
		x,
		y,
		width: Math.max(measurement.minimumWidth, envelope.right - x + measurement.padding),
		height: Math.max(measurement.minimumHeight, envelope.bottom - y + measurement.padding),
	};
}

/** Transverse room a block's frame keeps before and after its members. */
export interface FrameReserve {
	readonly before: number;
	readonly after: number;
}

/** Widen a frame across the rows by the room it reserves on each side. */
export function reserveFrame(box: MutableBounds, reserve: FrameReserve, vertical: boolean): void {
	translateTransversely(box, -reserve.before, vertical);
	if (vertical) box.width += reserve.before + reserve.after;
	else box.height += reserve.before + reserve.after;
}
