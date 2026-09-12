import { defined } from '../../document/logic-document';

export interface RailRun {
	readonly start: number;
	readonly end: number;
	rail: number;
}
interface RailEnd {
	readonly end: number;
	readonly rail: number;
}

function push(heap: RailEnd[], value: RailEnd): void {
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

function pop(heap: RailEnd[]): RailEnd {
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

/** Interval coloring, O(n log n): disjoint runs reuse a rail, with room around contacts. */
export function packRails(runs: readonly RailRun[], offset: number): number {
	const ordered = [...runs].sort((a, b) => a.start - b.start || a.end - b.end);
	const heap: RailEnd[] = [];
	let count = 0;
	for (const run of ordered) {
		let rail = offset + count;
		const first = heap[0];
		const before = run.start - 12;
		if (first !== undefined && first.end < before) rail = pop(heap).rail;
		else count += 1;
		run.rail = rail;
		push(heap, { end: run.end, rail });
	}
	return count;
}
