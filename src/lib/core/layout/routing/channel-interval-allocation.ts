import { defined } from '../../document/logic-document';
import type { ChannelRoutingEdge } from './channel-types';

export interface ChannelIntervalDemand {
	/** Identity of this run occurrence, independent of its source relation(s). */
	readonly key: string;
	readonly start: number;
	readonly end: number;
}

export interface ChannelIntervalAllocation {
	readonly edge: ChannelRoutingEdge;
	readonly trackByRunKey: ReadonlyMap<string, number>;
	readonly trackCount: number;
}

interface TrackEnd {
	readonly end: number;
	readonly track: number;
}

function push(heap: TrackEnd[], value: TrackEnd): void {
	let index = heap.length;
	heap.push(value);
	while (index > 0) {
		const parent = Math.floor((index - 1) / 2);
		if (defined(heap[parent]).end <= value.end) break;
		heap[index] = defined(heap[parent]);
		index = parent;
	}
	heap[index] = value;
}

function pop(heap: TrackEnd[]): TrackEnd {
	const result = defined(heap[0]);
	const last = defined(heap.pop());
	if (heap.length === 0) return result;
	let index = 0;
	while (index * 2 + 1 < heap.length) {
		let child = index * 2 + 1;
		const sibling = heap[child + 1];
		if (sibling !== undefined && sibling.end < defined(heap[child]).end) child += 1;
		if (defined(heap[child]).end >= last.end) break;
		heap[index] = defined(heap[child]);
		index = child;
	}
	heap[index] = last;
	return result;
}

/** Channel interval policy: stable start/end order, first released track and strict half-spacing clearance. */
export function allocateChannelIntervals(
	edge: ChannelRoutingEdge,
	demands: readonly ChannelIntervalDemand[],
	offset: number,
	trackByRunKey = new Map<string, number>(),
): ChannelIntervalAllocation {
	const ordered = [...demands].sort((a, b) => a.start - b.start || a.end - b.end);
	const heap: TrackEnd[] = [];
	let trackCount = 0;
	for (const demand of ordered) {
		let track = offset + trackCount;
		const first = heap[0];
		const before = demand.start - edge.spacing / 2;
		if (first !== undefined && first.end < before) track = pop(heap).track;
		else {
			if (offset + trackCount >= edge.capacity)
				throw new Error(`Routing edge ${edge.ownerId} has insufficient channel tracks.`);
			trackCount += 1;
		}
		trackByRunKey.set(demand.key, track);
		push(heap, { end: demand.end, track });
	}
	return { edge, trackByRunKey, trackCount };
}
