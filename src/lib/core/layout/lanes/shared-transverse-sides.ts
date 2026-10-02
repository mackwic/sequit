import {
	crossEnd,
	crossStart,
	longEnd,
	longStart,
} from '../geometry/shared-lane-geometry-primitives';
import type { Bounds } from '../layout-types';
import type { LaneSide } from './shared-lane-model';

export interface TransverseSideInput {
	readonly sourceLane: number;
	readonly targetLane: number;
	readonly source: Bounds;
	readonly target: Bounds;
	readonly vertical: boolean;
}

/**
 * The logical faces of one transverse route. Lanes and the rows of one lane both stack along the
 * rank axis, so endpoints on different lanes or rows join their facing faces; inside a lane the
 * cross column grows with the row, which the cross centres read without the direction's reversal.
 * Endpoints of one row both use the face on the side of the other's cross column.
 */
export function transverseRouteSides(input: TransverseSideInput): {
	readonly source: LaneSide;
	readonly target: LaneSide;
} {
	if (input.sourceLane < input.targetLane) return { source: 1, target: -1 };
	if (input.sourceLane > input.targetLane) return { source: -1, target: 1 };
	const sourceStart = crossStart(input.source, input.vertical);
	const sourceEnd = crossEnd(input.source, input.vertical);
	const targetStart = crossStart(input.target, input.vertical);
	const targetEnd = crossEnd(input.target, input.vertical);
	const sourceCenter = (sourceStart + sourceEnd) / 2;
	const targetCenter = (targetStart + targetEnd) / 2;
	const sourceBeforeTarget =
		longEnd(input.source, input.vertical) <= longStart(input.target, input.vertical);
	const targetBeforeSource =
		longEnd(input.target, input.vertical) <= longStart(input.source, input.vertical);
	if (sourceBeforeTarget || targetBeforeSource) {
		if (sourceCenter < targetCenter) return { source: 1, target: -1 };
		return { source: -1, target: 1 };
	}
	if (sourceCenter < targetCenter) return { source: 1, target: 1 };
	return { source: -1, target: -1 };
}

export function physicalTransverseSide(side: LaneSide, reverse: boolean): LaneSide {
	if (!reverse) return side;
	if (side === 1) return -1;
	return 1;
}
