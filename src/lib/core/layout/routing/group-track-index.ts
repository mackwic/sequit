import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';

export interface GroupTrackIndex {
	readonly edges: readonly number[];
}

/** Sort obstacle sides once; a blocked route visits near tracks before distant ones. */
export function prepareGroupTrackIndex(
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): GroupTrackIndex {
	const edges = new Set<number>();
	for (const box of bounds.values()) {
		let start = box.y;
		let extent = box.height;
		if (vertical) {
			start = box.x;
			extent = box.width;
		}
		edges.add(start - RAIL_SPACING);
		edges.add(start + extent + RAIL_SPACING);
	}
	return {
		edges: [...edges].filter((coordinate) => coordinate >= 0).sort((left, right) => left - right),
	};
}

function lowerBound(values: readonly number[], coordinate: number): number {
	let start = 0;
	let end = values.length;
	while (start < end) {
		const middle = Math.floor((start + end) / 2);
		if (defined(values[middle]) < coordinate) start = middle + 1;
		else end = middle;
	}
	return start;
}

function cost(coordinate: number, source: number, target: number): number {
	return Math.abs(coordinate - source) + Math.abs(coordinate - target);
}

/** Enumerate every obstacle edge lazily, by Manhattan detour cost, without resorting all boxes. */
export function* candidateTracks(
	index: GroupTrackIndex,
	source: number,
	target: number,
): Generator<number> {
	const fromSource = [source - RAIL_SPACING, source + RAIL_SPACING];
	const fromTarget = [target - RAIL_SPACING, target + RAIL_SPACING];
	const near = [...new Set([...fromSource, ...fromTarget])].filter((coordinate) => coordinate >= 0);
	near.sort(
		(left, right) => cost(left, source, target) - cost(right, source, target) || left - right,
	);
	for (const coordinate of near) yield coordinate;
	let below = lowerBound(index.edges, Math.min(source, target)) - 1;
	let above = below + 1;
	while (below >= 0 || above < index.edges.length) {
		const lower = index.edges[below];
		const upper = index.edges[above];
		let coordinate: number;
		let lowerCost = Infinity;
		if (lower !== undefined) lowerCost = cost(lower, source, target);
		let upperCost = Infinity;
		if (upper !== undefined) upperCost = cost(upper, source, target);
		if (lower !== undefined && lowerCost <= upperCost) {
			coordinate = lower;
			below -= 1;
		} else {
			coordinate = defined(upper);
			above += 1;
		}
		if (!near.includes(coordinate)) yield coordinate;
	}
}
