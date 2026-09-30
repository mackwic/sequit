import { defined } from '../../document/logic-document';
import type { ChannelRun, ChannelWire } from './channel-types';

/** A run with the sorted columns leaving it toward the target row or reaching it from the source row. */
interface RunRisers {
	readonly run: ChannelRun;
	readonly up: number[];
	readonly down: number[];
}

interface Track {
	readonly runs: readonly RunRisers[];
	readonly start: number;
	readonly end: number;
	/**
	 * The track last found to gain nothing by sinking below this one. The gain is pure: it reads
	 * only run spans and risers, which stay fixed while tracks are reordered (rails are written
	 * after the loop), so the verdict for this ordered pair survives any neighbour swap.
	 */
	keepsAbove: Track | undefined;
}

/** Risers by run key, given the runs in key order. */
function runRisers(
	wires: readonly ChannelWire[],
	runs: readonly ChannelRun[],
): readonly RunRisers[] {
	const risers = runs.map((run): RunRisers => ({ run, up: [], down: [] }));
	for (const wire of wires) {
		if (wire.first === undefined) continue;
		defined(risers[wire.first.key]).down.push(wire.source);
		defined(risers[defined(wire.last).key]).up.push(wire.target);
	}
	for (const { up, down } of risers) {
		if (up.length > 1) up.sort((a, b) => a - b);
		if (down.length > 1) down.sort((a, b) => a - b);
	}
	return risers;
}

/** First index whose column is greater than `value`, or not less when `inclusive`. */
function bound(columns: readonly number[], value: number, inclusive: boolean): number {
	let low = 0;
	let high = columns.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const column = defined(columns[middle]);
		const onEdge = !inclusive && column === value;
		if (column < value || onEdge) low = middle + 1;
		else high = middle;
	}
	return low;
}

function inside(run: ChannelRun, columns: readonly number[]): number {
	if (columns.length === 0) return 0;
	if (columns.length === 1) {
		const column = defined(columns[0]);
		return Number(run.start < column && column < run.end);
	}
	return bound(columns, run.end, true) - bound(columns, run.start, false);
}

/** Risers of `low` rising through `high`, plus risers of `high` descending through `low`. */
function crossingsBelow(low: RunRisers, high: RunRisers): number {
	return inside(high.run, low.up) + inside(low.run, high.down);
}

/**
 * Crossings removed by stacking `upper` below `lower`. Runs of one track are disjoint and sorted,
 * so a merge visits only overlapping pairs.
 */
function stackingGain(lower: Track, upper: Track): number {
	if (lower.start >= upper.end || upper.start >= lower.end) return 0;
	let gain = 0;
	let left = 0;
	let right = 0;
	while (left < lower.runs.length && right < upper.runs.length) {
		const low = defined(lower.runs[left]);
		const high = defined(upper.runs[right]);
		if (low.run.start < high.run.end && high.run.start < low.run.end)
			gain += crossingsBelow(low, high) - crossingsBelow(high, low);
		if (low.run.end <= high.run.end) left += 1;
		else right += 1;
	}
	return gain;
}

/** The tracks of one layer, by ascending rail; a layer's rails are a contiguous range. */
function tracksOf(
	runs: readonly ChannelRun[],
	risers: readonly RunRisers[],
): { readonly rails: readonly number[]; readonly tracks: Track[] } {
	let lowest = Infinity;
	for (const run of runs) lowest = Math.min(lowest, run.rail);
	const byRail: RunRisers[][] = [];
	for (const run of runs) {
		const members = byRail[run.rail - lowest];
		const entry = defined(risers[run.key]);
		if (members === undefined) byRail[run.rail - lowest] = [entry];
		else members.push(entry);
	}
	const rails: number[] = [];
	const tracks: Track[] = [];
	for (let offset = 0; offset < byRail.length; offset += 1) {
		const members = byRail[offset];
		if (members === undefined) continue;
		if (members.length > 1) members.sort((a, b) => a.run.start - b.run.start);
		let start = Infinity;
		let end = -Infinity;
		for (const { run } of members) {
			start = Math.min(start, run.start);
			end = Math.max(end, run.end);
		}
		rails.push(lowest + offset);
		tracks.push({ runs: members, start, end, keepsAbove: undefined });
	}
	return { rails, tracks };
}

/** Sink the track at `next` while the swap removes crossings; report whether it moved. */
function sinkTrack(tracks: Track[], next: number): boolean {
	let moved = false;
	for (let index = next; index > 0; index -= 1) {
		const lower = defined(tracks[index - 1]);
		const upper = defined(tracks[index]);
		if (lower.keepsAbove === upper) break;
		if (stackingGain(lower, upper) <= 0) {
			lower.keepsAbove = upper;
			break;
		}
		tracks[index - 1] = upper;
		tracks[index] = lower;
		moved = true;
	}
	return moved;
}

/** Adjacent transpositions change only their own pair cost, so each kept swap removes crossings. */
function untangleLayer(runs: readonly ChannelRun[], risers: readonly RunRisers[]) {
	const { rails, tracks } = tracksOf(runs, risers);
	let swapped = true;
	while (swapped) {
		swapped = false;
		for (let next = 1; next < tracks.length; next += 1) if (sinkTrack(tracks, next)) swapped = true;
	}
	for (let index = 0; index < tracks.length; index += 1) {
		const rail = defined(rails[index]);
		for (const { run } of defined(tracks[index]).runs) run.rail = rail;
	}
}

/**
 * Tracks within one constraint layer are interchangeable: order them so that a run whose riser
 * lies inside another run's span passes on the side that keeps it clear, without adding tracks.
 * `runs` are in key order and `layers` partitions them by depth.
 */
export function untangleChannelRails(
	wires: readonly ChannelWire[],
	runs: readonly ChannelRun[],
	layers: readonly (readonly ChannelRun[])[],
	trackByRunKey: Map<number, number>,
): void {
	const risers = runRisers(wires, runs);
	for (const layer of layers) if (layer.length > 1) untangleLayer(layer, risers);
	for (const run of runs) trackByRunKey.set(run.key, run.rail);
}
