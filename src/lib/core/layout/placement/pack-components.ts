import { defined } from '../../document/logic-document';
import { transverseEnvelope } from '../geometry/envelope';
import {
	biasedMainStart,
	type LayoutFrame,
	mainSize,
	type MutableBounds,
	pointOnAxes,
	translateBounds,
	translateTransversely,
	transverseSize,
} from '../geometry/layout-frame';
import { COMPONENT_GAP, OUTER_MARGIN } from '../layout-settings';
import type { ComponentLayout } from './place-component';

export interface PackingCursor {
	cross: number;
	readonly maximumPrimaryLength: number;
}

export function packComponents(
	components: readonly ComponentLayout[],
	bounds: Map<string, MutableBounds>,
	frame: LayoutFrame,
): PackingCursor {
	let maximumPrimaryLength = 0;
	for (const component of components)
		maximumPrimaryLength = Math.max(maximumPrimaryLength, mainSize(component, frame.vertical));
	let cross = OUTER_MARGIN;
	for (const component of components) {
		const primary =
			OUTER_MARGIN +
			biasedMainStart(mainSize(component, frame.vertical), maximumPrimaryLength, frame);
		const offset = pointOnAxes(cross, primary, frame.vertical);
		for (const [id, box] of component.boundsById) {
			translateBounds(box, offset.x, offset.y);
			bounds.set(id, box);
		}
		cross += transverseSize(component, frame.vertical) + COMPONENT_GAP;
	}
	return { cross, maximumPrimaryLength };
}

export function repackContainment(
	components: readonly (readonly string[])[],
	bounds: Map<string, MutableBounds>,
	vertical: boolean,
): void {
	let cross = OUTER_MARGIN;
	for (const ids of components) {
		const extent = transverseEnvelope(ids, bounds, vertical);
		const shift = cross - extent.start;
		for (const id of ids) translateTransversely(defined(bounds.get(id)), shift, vertical);
		cross += extent.end - extent.start + COMPONENT_GAP;
	}
}

export function applyOuterMargin(bounds: Map<string, MutableBounds>): void {
	let minimumX = Number.POSITIVE_INFINITY;
	let minimumY = Number.POSITIVE_INFINITY;
	for (const box of bounds.values()) {
		minimumX = Math.min(minimumX, box.x);
		minimumY = Math.min(minimumY, box.y);
	}
	const shiftX = Math.max(0, OUTER_MARGIN - minimumX);
	const shiftY = Math.max(0, OUTER_MARGIN - minimumY);
	if (shiftX === 0 && shiftY === 0) return;
	for (const box of bounds.values()) translateBounds(box, shiftX, shiftY);
}
