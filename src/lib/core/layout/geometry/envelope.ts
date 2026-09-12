import { defined } from '../../document/logic-document';
import type { Bounds } from '../layout-types';
import { transverseSize, transverseStart } from './layout-frame';

export interface Interval {
	readonly start: number;
	readonly end: number;
}

export interface Envelope {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** The caller selects a non-empty set; selection does not create a document group. */
export function envelopeOf(ids: readonly string[], bounds: ReadonlyMap<string, Bounds>): Envelope {
	let x = Number.POSITIVE_INFINITY;
	let y = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const id of ids) {
		const box = defined(bounds.get(id));
		x = Math.min(x, box.x);
		y = Math.min(y, box.y);
		right = Math.max(right, box.x + box.width);
		bottom = Math.max(bottom, box.y + box.height);
	}
	return { left: x, top: y, right, bottom };
}

export function transverseEnvelope(
	ids: readonly string[],
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): Interval {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const id of ids) {
		const box = defined(bounds.get(id));
		const position = transverseStart(box, vertical);
		start = Math.min(start, position);
		end = Math.max(end, position + transverseSize(box, vertical));
	}
	return { start, end };
}
