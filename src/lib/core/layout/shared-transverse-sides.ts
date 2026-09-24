import type { Bounds } from './layout-types';
import { crossEnd, crossStart } from './shared-lane-geometry-primitives';
import type { LaneSide } from './shared-lane-model';

export interface TransverseSideInput {
	readonly sourceLane: number;
	readonly targetLane: number;
	readonly source: Bounds;
	readonly target: Bounds;
	readonly vertical: boolean;
}

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
	if (sourceCenter < targetCenter) return { source: 1, target: 1 };
	return { source: -1, target: -1 };
}

export function physicalTransverseSide(side: LaneSide, reverse: boolean): LaneSide {
	if (!reverse) return side;
	if (side === 1) return -1;
	return 1;
}
