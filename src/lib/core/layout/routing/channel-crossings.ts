import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { ChannelRun, ChannelWire } from './channel-types';

/**
 * A block exchange reaches the track after next: passing the track in between is how two runs
 * of one track part around a run of their neighbour. Pricing every pair of tracks made each sweep
 * quadratic in tracks for almost nothing more on the corpora.
 */
const EXCHANGE_REACH = 2;

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

/** First index of the sorted, disjoint `runs` whose run ends after `column`. */
function firstEndingAfter(runs: readonly RunRisers[], column: number): number {
	let low = 0;
	let high = runs.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (defined(runs[middle]).run.end <= column) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** Where `stackingGain` also files each pair's gain: at the block of its lower or upper run. */
interface Attribution {
	readonly blocks: readonly number[];
	readonly ofUpper: boolean;
	readonly gains: number[];
}

/** File `pair` at the block of run `left` of the lower track, or of run `right` of the upper one. */
function attribute(
	attribution: Attribution | undefined,
	left: number,
	right: number,
	pair: number,
) {
	if (attribution === undefined) return;
	let index = left;
	if (attribution.ofUpper) index = right;
	const block = defined(attribution.blocks[index]);
	attribution.gains[block] = defined(attribution.gains[block]) + pair;
}

/**
 * Crossings removed by stacking `upper` below `lower`. Runs of one track are disjoint and sorted,
 * so a merge over their shared span visits only overlapping pairs.
 */
function stackingGain(lower: Track, upper: Track, attribution?: Attribution): number {
	if (lower.start >= upper.end || upper.start >= lower.end) return 0;
	let gain = 0;
	let left = firstEndingAfter(lower.runs, upper.start);
	let right = firstEndingAfter(upper.runs, lower.start);
	while (left < lower.runs.length && right < upper.runs.length) {
		const low = defined(lower.runs[left]);
		const high = defined(upper.runs[right]);
		if (low.run.start >= upper.end || high.run.start >= lower.end) break;
		if (low.run.start < high.run.end && high.run.start < low.run.end) {
			const pair = crossingsBelow(low, high) - crossingsBelow(high, low);
			gain += pair;
			attribute(attribution, left, right, pair);
		}
		if (low.run.end <= high.run.end) left += 1;
		else right += 1;
	}
	return gain;
}

function trackOf(runs: readonly RunRisers[]): Track {
	let start = Infinity;
	let end = -Infinity;
	for (const { run } of runs) {
		start = Math.min(start, run.start);
		end = Math.max(end, run.end);
	}
	return { runs, start, end, keepsAbove: undefined };
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
		rails.push(lowest + offset);
		tracks.push(trackOf(members));
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
function sinkTracks(tracks: Track[]): void {
	let swapped = true;
	while (swapped) {
		swapped = false;
		for (let next = 1; next < tracks.length; next += 1) if (sinkTrack(tracks, next)) swapped = true;
	}
}

/** The block of every run of two tracks, by track, and how many blocks there are. */
interface Blocks {
	readonly lower: number[];
	readonly upper: number[];
	count: number;
}

/**
 * Cut two tracks where every run on the left ends a clearance before every run on the right
 * starts, the rule by which the allocator reuses a channel track: the runs between two cuts
 * form a block that may change track as a whole.
 */
function blocksOf(lower: Track, upper: Track): Blocks {
	const blocks: Blocks = { lower: [], upper: [], count: 0 };
	let reach = -Infinity;
	while (blocks.lower.length < lower.runs.length || blocks.upper.length < upper.runs.length) {
		const low = lower.runs[blocks.lower.length];
		const high = upper.runs[blocks.upper.length];
		const lowStart = low?.run.start ?? Infinity;
		const highStart = high?.run.start ?? Infinity;
		if (reach + RAIL_SPACING / 2 < Math.min(lowStart, highStart)) blocks.count += 1;
		let entry = high;
		if (lowStart <= highStart) {
			entry = low;
			blocks.lower.push(blocks.count - 1);
		} else blocks.upper.push(blocks.count - 1);
		reach = Math.max(reach, defined(entry).run.end);
	}
	return blocks;
}

/**
 * Exchange between two tracks every block that crosses less on the other track: its lower runs
 * pass above its upper runs and above the tracks in between, which its upper runs pass below.
 * Other blocks keep clear of its span and tracks outside the pair keep their side of every moved
 * run, so each block is priced alone. Tracks of one run at most could only swap whole, which is
 * left to sinking.
 */
function exchangeBlocks(tracks: Track[], lower: number, upper: number): boolean {
	const low = defined(tracks[lower]);
	const high = defined(tracks[upper]);
	if (low.runs.length < 2 && high.runs.length < 2) return false;
	const blocks = blocksOf(low, high);
	const gains = new Array<number>(blocks.count).fill(0);
	const rising: Attribution = { blocks: blocks.lower, ofUpper: false, gains };
	stackingGain(low, high, rising);
	for (let index = lower + 1; index < upper; index += 1) {
		const between = defined(tracks[index]);
		stackingGain(low, between, rising);
		stackingGain(between, high, { blocks: blocks.upper, ofUpper: true, gains });
	}
	if (gains.every((gain) => gain <= 0)) return false;
	const lowerRuns: RunRisers[] = [];
	const upperRuns: RunRisers[] = [];
	for (const side of [
		{ runs: low.runs, blocks: blocks.lower, stay: lowerRuns, move: upperRuns },
		{ runs: high.runs, blocks: blocks.upper, stay: upperRuns, move: lowerRuns },
	])
		for (const [index, run] of side.runs.entries()) {
			let to = side.stay;
			if (defined(gains[defined(side.blocks[index])]) > 0) to = side.move;
			to.push(run);
		}
	tracks[lower] = trackOf(lowerRuns.sort((a, b) => a.run.start - b.run.start));
	tracks[upper] = trackOf(upperRuns.sort((a, b) => a.run.start - b.run.start));
	return true;
}

/**
 * The allocator packs disjoint runs on one track whatever their risers, so whole-track swaps
 * cannot part two runs that must pass on opposite sides of a run on a neighbouring track. Once
 * sunk, one sweep of block exchanges does; the tracks it rebuilt then sink again. Each kept swap
 * or exchange removes crossings. Sweeping until nothing moves found nothing more on the corpora,
 * while dense channels would pay a sweep per crossing removed.
 */
function untangleLayer(runs: readonly ChannelRun[], risers: readonly RunRisers[]) {
	const { rails, tracks } = tracksOf(runs, risers);
	sinkTracks(tracks);
	let exchanged = false;
	for (let lower = 0; lower < tracks.length; lower += 1) {
		const last = Math.min(lower + EXCHANGE_REACH, tracks.length - 1);
		for (let upper = lower + 1; upper <= last; upper += 1)
			if (exchangeBlocks(tracks, lower, upper)) exchanged = true;
	}
	if (exchanged) sinkTracks(tracks);
	for (let index = 0; index < tracks.length; index += 1) {
		const rail = defined(rails[index]);
		for (const { run } of defined(tracks[index]).runs) run.rail = rail;
	}
}

/**
 * Tracks within one constraint layer are interchangeable: order them, and exchange blocks of runs
 * between near tracks, so that a run whose riser lies inside another run's span passes on the
 * side that keeps it clear, without adding tracks. `runs` are in key order and `layers`
 * partitions them by depth.
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
