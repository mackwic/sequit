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
}

function runRisers(wires: readonly ChannelWire[]): ReadonlyMap<ChannelRun, RunRisers> {
	const risers = new Map<ChannelRun, RunRisers>();
	const of = (run: ChannelRun) => {
		let entry = risers.get(run);
		if (entry === undefined) {
			entry = { run, up: [], down: [] };
			risers.set(run, entry);
		}
		return entry;
	};
	for (const wire of wires) {
		if (wire.first === undefined) continue;
		of(wire.first).down.push(wire.source);
		of(defined(wire.last)).up.push(wire.target);
	}
	for (const { up, down } of risers.values()) {
		up.sort((a, b) => a - b);
		down.sort((a, b) => a - b);
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

function tracksOf(
	runs: readonly ChannelRun[],
	risers: ReadonlyMap<ChannelRun, RunRisers>,
): { readonly rails: readonly number[]; readonly tracks: Track[] } {
	const byRail = new Map<number, RunRisers[]>();
	for (const run of runs) {
		const track = byRail.get(run.rail) ?? [];
		track.push(risers.get(run) ?? { run, up: [], down: [] });
		byRail.set(run.rail, track);
	}
	const rails = [...byRail.keys()].sort((a, b) => a - b);
	const tracks = rails.map((rail) => {
		const members = defined(byRail.get(rail)).sort((a, b) => a.run.start - b.run.start);
		let start = Infinity;
		let end = -Infinity;
		for (const { run } of members) {
			start = Math.min(start, run.start);
			end = Math.max(end, run.end);
		}
		return { runs: members, start, end };
	});
	return { rails, tracks };
}

/** Sink the track at `next` while the swap removes crossings; report whether it moved. */
function sinkTrack(tracks: Track[], next: number): boolean {
	let moved = false;
	for (let index = next; index > 0; index -= 1) {
		const lower = defined(tracks[index - 1]);
		const upper = defined(tracks[index]);
		if (stackingGain(lower, upper) <= 0) break;
		tracks[index - 1] = upper;
		tracks[index] = lower;
		moved = true;
	}
	return moved;
}

/** Adjacent transpositions change only their own pair cost, so each kept swap removes crossings. */
function untangleLayer(runs: readonly ChannelRun[], risers: ReadonlyMap<ChannelRun, RunRisers>) {
	const { rails, tracks } = tracksOf(runs, risers);
	let swapped = true;
	while (swapped) {
		swapped = false;
		for (let next = 1; next < tracks.length; next += 1) if (sinkTrack(tracks, next)) swapped = true;
	}
	for (const [index, track] of tracks.entries())
		for (const { run } of track.runs) run.rail = defined(rails[index]);
}

/**
 * Tracks within one constraint layer are interchangeable: order them so that a run whose riser
 * lies inside another run's span passes on the side that keeps it clear, without adding tracks.
 */
export function untangleChannelRails(
	wires: readonly ChannelWire[],
	runs: readonly ChannelRun[],
	trackByRunKey: Map<number, number>,
): void {
	const layers = new Map<number, ChannelRun[]>();
	for (const run of runs) {
		const layer = layers.get(run.depth) ?? [];
		layer.push(run);
		layers.set(run.depth, layer);
	}
	const risers = runRisers(wires);
	for (const layer of layers.values()) if (layer.length > 1) untangleLayer(layer, risers);
	for (const run of runs) trackByRunKey.set(run.key, run.rail);
}
