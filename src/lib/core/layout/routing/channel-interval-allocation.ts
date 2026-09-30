import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';

export interface ChannelIntervalDemand<Key extends string | number> {
	/** Identity of this run occurrence, independent of its source relation(s). */
	readonly key: Key;
	/** The selected track is also read by the existing route materializer. */
	rail: number;
	readonly start: number;
	readonly end: number;
}

export interface ChannelIntervalAllocation<Key extends string | number> {
	readonly edge: RoutingEdge;
	readonly trackByRunKey: ReadonlyMap<Key, number>;
	readonly trackCount: number;
}

/** A binary min-heap of released tracks by end, stored as parallel columns. */
interface TrackHeap {
	readonly ends: number[];
	readonly tracks: number[];
}

function push(heap: TrackHeap, end: number, track: number): void {
	const { ends, tracks } = heap;
	let index = ends.length;
	ends.push(end);
	tracks.push(track);
	while (index > 0) {
		const parent = Math.floor((index - 1) / 2);
		const parentEnd = defined(ends[parent]);
		if (parentEnd <= end) break;
		ends[index] = parentEnd;
		tracks[index] = defined(tracks[parent]);
		index = parent;
	}
	ends[index] = end;
	tracks[index] = track;
}

/** Remove the earliest-ending entry and return its track. */
function pop(heap: TrackHeap): number {
	const { ends, tracks } = heap;
	const result = defined(tracks[0]);
	const lastEnd = defined(ends.pop());
	const lastTrack = defined(tracks.pop());
	if (ends.length === 0) return result;
	let index = 0;
	while (index * 2 + 1 < ends.length) {
		let child = index * 2 + 1;
		const sibling = ends[child + 1];
		if (sibling !== undefined && sibling < defined(ends[child])) child += 1;
		const childEnd = defined(ends[child]);
		if (childEnd >= lastEnd) break;
		ends[index] = childEnd;
		tracks[index] = defined(tracks[child]);
		index = child;
	}
	ends[index] = lastEnd;
	tracks[index] = lastTrack;
	return result;
}

/** Channel interval policy: stable start/end order, first released track and strict half-spacing clearance. */
export function allocateChannelIntervals<Key extends string | number>(
	edge: RoutingEdge,
	demands: readonly ChannelIntervalDemand<Key>[],
	offset: number,
	trackByRunKey = new Map<Key, number>(),
): ChannelIntervalAllocation<Key> {
	const ordered = [...demands].sort((a, b) => a.start - b.start || a.end - b.end);
	const heap: TrackHeap = { ends: [], tracks: [] };
	let trackCount = 0;
	for (const demand of ordered) {
		let track = offset + trackCount;
		const firstEnd = heap.ends[0];
		const before = demand.start - edge.spacing / 2;
		if (firstEnd !== undefined && firstEnd < before) track = pop(heap);
		else {
			if (offset + trackCount >= edge.capacity)
				throw new Error(`Routing edge ${edge.ownerId} has insufficient channel tracks.`);
			trackCount += 1;
		}
		demand.rail = track;
		trackByRunKey.set(demand.key, track);
		push(heap, demand.end, track);
	}
	return { edge, trackByRunKey, trackCount };
}
