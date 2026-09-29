import { envelopeOf } from '../geometry/envelope';
import type { MutableBounds } from '../geometry/layout-frame';
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
