import { transverseEnvelope } from '../geometry/envelope';
import {
	type MutableBounds,
	translateTransversely,
	transverseCenter,
} from '../geometry/layout-frame';

/**
 * Apply relative center constraints, then normalize before component packing. The first
 * constrained box stays put: a chain aligns where it stands among unrelated boxes.
 */
export function alignComponentCenters(
	bounds: Map<string, MutableBounds>,
	centers: ReadonlyMap<string, number>,
	vertical: boolean,
	crossLength: number,
): number {
	let changed = false;
	let origin: number | undefined;
	for (const [id, box] of bounds) {
		const center = centers.get(id);
		if (center === undefined) continue;
		origin ??= transverseCenter(box, vertical) - center;
		translateTransversely(box, center + origin - transverseCenter(box, vertical), vertical);
		changed = true;
	}
	if (!changed) return crossLength;
	const extent = transverseEnvelope([...bounds.keys()], bounds, vertical);
	for (const box of bounds.values()) translateTransversely(box, -extent.start, vertical);
	return extent.end - extent.start;
}
