import { transverseEnvelope } from '../geometry/envelope';
import {
	type MutableBounds,
	translateTransversely,
	transverseCenter,
} from '../geometry/layout-frame';

/** Apply component-local center constraints, then normalize before component packing. */
export function alignComponentCenters(
	bounds: Map<string, MutableBounds>,
	centers: ReadonlyMap<string, number>,
	vertical: boolean,
	crossLength: number,
): number {
	let changed = false;
	for (const [id, box] of bounds) {
		const center = centers.get(id);
		if (center === undefined) continue;
		translateTransversely(box, center - transverseCenter(box, vertical), vertical);
		changed = true;
	}
	if (!changed) return crossLength;
	const extent = transverseEnvelope([...bounds.keys()], bounds, vertical);
	for (const box of bounds.values()) translateTransversely(box, -extent.start, vertical);
	return extent.end - extent.start;
}
