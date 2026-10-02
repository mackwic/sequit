import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import { untangleChannelRails } from './channel-crossings';
import { allocateChannelIntervals } from './channel-interval-allocation';
import type {
	ChannelEndpoint,
	ChannelRailAllocation,
	ChannelRouting,
	ChannelRun,
	ChannelWire,
} from './channel-types';
import { compactChannelRails, nestChannelEndpointRuns } from './rail-packing';

enum RunSide {
	First = 'first',
	Last = 'last',
}

function hasSharedEndpoint(wire: ChannelEndpoint): boolean {
	return wire.sharedSource !== undefined || wire.sharedTarget !== undefined;
}

const UNVISITED = 0;
const ON_PATH = 1;
const EXPLORED = 2;
const NO_ARRIVALS: readonly number[] = [];
const NO_FAMILY_BREAKS: readonly ChannelWire[] = [];

interface CycleSearch {
	readonly wires: readonly ChannelWire[];
	/** Wire indices by the column they reach. */
	readonly arrivals: ReadonlyMap<number, readonly number[]>;
	readonly state: Uint8Array;
	readonly breaks: Set<ChannelWire>;
}

/** Explore the wires following `start`, breaking each wire that closes a cycle on the path. */
function exploreCycles(search: CycleSearch, start: number): void {
	const { wires, arrivals, state, breaks } = search;
	const path = [start];
	const offsets = [0];
	state[start] = ON_PATH;
	while (path.length > 0) {
		const top = path.length - 1;
		const wire = defined(path[top]);
		const offset = defined(offsets[top]);
		offsets[top] = offset + 1;
		const column = arrivals.get(defined(wires[wire]).source) ?? NO_ARRIVALS;
		const following = column[column.length - 1 - offset];
		if (following === undefined) {
			state[wire] = EXPLORED;
			path.pop();
			offsets.pop();
		} else if (state[following] === ON_PATH) breaks.add(defined(wires[following]));
		else if (state[following] === UNVISITED) {
			state[following] = ON_PATH;
			path.push(following);
			offsets.push(0);
		}
	}
}

/**
 * A coincident departure must leave its column before another wire arrives there. Several
 * wires may arrive at one column, so these constraints form a general graph: a depth-first
 * search breaks the wire closing each cycle, following the latest arrival first. A wire leaving
 * a column that no wire reaches starts no search: it is never on a path when it is reached.
 */
function cycleBreaks(wires: readonly ChannelWire[]): Set<ChannelWire> {
	const arrivals = new Map<number, number[]>();
	for (let index = 0; index < wires.length; index += 1) {
		const target = defined(wires[index]).target;
		const column = arrivals.get(target);
		if (column === undefined) arrivals.set(target, [index]);
		else column.push(index);
	}
	const search: CycleSearch = {
		wires,
		arrivals,
		state: new Uint8Array(wires.length),
		breaks: new Set<ChannelWire>(),
	};
	for (let start = 0; start < wires.length; start += 1)
		if (search.state[start] === UNVISITED && arrivals.has(defined(wires[start]).source))
			exploreCycles(search, start);
	return search.breaks;
}

function run(source: number, target: number): ChannelRun {
	return {
		key: -1,
		start: Math.min(source, target),
		end: Math.max(source, target),
		rail: 0,
		next: [],
		remaining: 0,
		depth: 0,
	};
}

function precedes(first: ChannelRun, last: ChannelRun): void {
	first.next.push(last);
	last.remaining += 1;
}

/** First index of `sorted`, ordered by source column, whose wire does not leave before `column`. */
function firstDeparture(sorted: readonly ChannelWire[], column: number): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (defined(sorted[middle]).source < column) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** The turning wires leaving the column `wire` reaches must first leave it, in source order. */
function orderDepartures(sorted: readonly ChannelWire[], wire: ChannelWire): void {
	for (let index = firstDeparture(sorted, wire.target); index < sorted.length; index += 1) {
		const departure = defined(sorted[index]);
		if (departure.source !== wire.target) return;
		if (departure.source === departure.target) continue;
		if (departure.first !== wire.last) precedes(defined(departure.first), defined(wire.last));
	}
}

/**
 * Shared endpoint families can turn independent column dependencies into a cycle: a departure
 * leaves its column first, then joins the shared arrival traverse, unless the column is only
 * reached by the straight trunk of its own departing family, which shares its port.
 */
function sharedEndpointBreaks(
	wires: readonly ChannelWire[],
	moving: readonly ChannelWire[],
): Set<ChannelWire> {
	// The departing family reaching each column, `undefined` for an unshared or mixed arrival.
	const arrivals = new Map<number, string | undefined>();
	for (const wire of wires) {
		if (!arrivals.has(wire.target)) arrivals.set(wire.target, wire.sharedSource);
		else if (arrivals.get(wire.target) !== wire.sharedSource) arrivals.set(wire.target, undefined);
	}
	return new Set(
		moving.filter((wire) => {
			if (!arrivals.has(wire.source)) return false;
			const family = arrivals.get(wire.source);
			return family === undefined || family !== wire.sharedSource;
		}),
	);
}

function makeRuns(
	wires: readonly ChannelWire[],
	sharedEndpoints: boolean,
	nonInverted: boolean,
	familyBreaks: ReadonlySet<ChannelWire> | undefined,
): ChannelRun[] {
	let moving = wires;
	if (sharedEndpoints) moving = wires.filter((wire) => wire.source !== wire.target);
	let breaks: Set<ChannelWire>;
	if (sharedEndpoints) breaks = sharedEndpointBreaks(wires, moving);
	else if (nonInverted) breaks = new Set();
	else breaks = cycleBreaks(moving);
	for (const wire of familyBreaks ?? NO_FAMILY_BREAKS) breaks.add(wire);
	const distinct = new Set<number>();
	if (breaks.size > 0)
		for (const wire of wires) {
			distinct.add(wire.source);
			distinct.add(wire.target);
		}
	const coordinates = [...distinct].sort((a, b) => a - b);
	const indices = new Map(coordinates.map((value, index) => [value, index]));
	const runs: ChannelRun[] = [];
	for (const wire of wires) {
		if (breaks.has(wire)) {
			let step = 1;
			if (wire.target < wire.source) step = -1;
			const neighbor = defined(coordinates[defined(indices.get(wire.source)) + step]);
			const offset = (neighbor - wire.source) / 3;
			wire.middle = wire.source + offset;
			wire.first = run(wire.source, wire.middle);
			wire.last = run(wire.middle, wire.target);
			precedes(wire.first, wire.last);
			runs.push(wire.first, wire.last);
		} else {
			wire.first = run(wire.source, wire.target);
			wire.last = wire.first;
			runs.push(wire.first);
		}
	}
	return runs;
}

function runOwners(wires: readonly ChannelWire[]): ReadonlyMap<ChannelRun, ReadonlySet<string>> {
	const owners = new Map<ChannelRun, Set<string>>();
	for (const wire of wires) {
		for (const segment of [defined(wire.first), defined(wire.last)]) {
			const sources = owners.get(segment) ?? new Set<string>();
			sources.add(wire.sharedSource ?? wire.id);
			owners.set(segment, sources);
		}
	}
	return owners;
}

function runFamilies(wires: readonly ChannelWire[], side: RunSide): readonly ChannelWire[][] {
	const owners = runOwners(wires);
	const families = new Map<string, ChannelWire[]>();
	for (const wire of wires) {
		let key = wire.sharedTarget;
		if (side === RunSide.First) key = wire.sharedSource;
		if (key === undefined) continue;
		if (side === RunSide.First) {
			// Preserve distinct arrival nets; merge shared detours before they can reunite.
			if (defined(owners.get(defined(wire.first))).size > 1) continue;
		}
		const family = families.get(key) ?? [];
		family.push(wire);
		families.set(key, family);
	}
	return [...families.values()].filter((family) => family.length > 1);
}

function mergeRuns(
	wires: readonly ChannelWire[],
	runs: ChannelRun[],
	side: RunSide,
	sharedEndpoints: boolean,
): ChannelRun[] {
	if (!sharedEndpoints) return runs;
	const replaced = new Map<ChannelRun, ChannelRun>();
	for (const family of runFamilies(wires, side)) {
		const shared = defined(defined(family[0])[side]);
		for (const wire of family.slice(1)) {
			const segment = defined(wire[side]);
			if (segment === shared) continue;
			shared.start = Math.min(shared.start, segment.start);
			shared.end = Math.max(shared.end, segment.end);
			replaced.set(segment, shared);
		}
	}
	if (replaced.size === 0) return runs;
	for (const wire of wires) {
		wire.first = replaced.get(defined(wire.first)) ?? wire.first;
		wire.last = replaced.get(defined(wire.last)) ?? wire.last;
	}
	const constraints = runs.flatMap((segment) =>
		segment.next.map((following) => ({
			first: replaced.get(segment) ?? segment,
			last: replaced.get(following) ?? following,
		})),
	);
	const retained = runs.filter((segment) => !replaced.has(segment));
	for (const segment of retained) {
		segment.remaining = 0;
		segment.next.length = 0;
	}
	for (const { first, last } of constraints) if (first !== last) precedes(first, last);
	return retained;
}

function assignRails(
	runs: readonly ChannelRun[],
	wires: readonly ChannelWire[],
	ownerId: string,
): ChannelRailAllocation | undefined {
	const ready = runs.filter((segment) => segment.remaining === 0);
	let nextRunKey = 0;
	const layers: ChannelRun[][] = [];
	for (const segment of ready) {
		segment.key = nextRunKey++;
		const layer = layers[segment.depth] ?? [];
		layer.push(segment);
		layers[segment.depth] = layer;
		for (const next of segment.next) {
			next.depth = Math.max(next.depth, segment.depth + 1);
			next.remaining -= 1;
			if (next.remaining === 0) ready.push(next);
		}
	}
	if (ready.length !== runs.length) return undefined;
	let count = 0;
	const edge = { ownerId, capacity: runs.length, spacing: RAIL_SPACING };
	const trackByRunKey = new Map<number, number>();
	for (const layer of layers) {
		count += allocateChannelIntervals(edge, layer, count, trackByRunKey).trackCount;
	}
	untangleChannelRails(wires, ready, layers);
	count = compactChannelRails(ready, trackByRunKey);
	edge.capacity = count;
	return { edge, trackByRunKey, railCount: count };
}

/** The caller owns these fresh wires; routing fills in their run references in place. */
export function routeOwnedChannel(
	wires: ChannelWire[],
	nonInverted = false,
	ownerId = '@root/channel',
): ChannelRouting {
	let sharedEndpoints = false;
	const moving = wires
		.filter((wire) => {
			const shared = hasSharedEndpoint(wire);
			if (shared) sharedEndpoints = true;
			return wire.source !== wire.target || shared;
		})
		// Wires at the same coordinates keep the caller's documentary order, never their ids.
		.sort((a, b) => a.source - b.source || a.target - b.target);
	let familyBreaks: Set<ChannelWire> | undefined;
	for (;;) {
		const arrivals = mergeRuns(
			moving,
			makeRuns(moving, sharedEndpoints, nonInverted, familyBreaks),
			RunSide.Last,
			sharedEndpoints,
		);
		const runs = mergeRuns(moving, arrivals, RunSide.First, sharedEndpoints);
		for (const wire of moving) {
			// Straight wires keep their column and impose no traverse order.
			if (wire.source !== wire.target) orderDepartures(moving, wire);
		}
		nestChannelEndpointRuns(moving);
		const allocation = assignRails(runs, moving, ownerId);
		if (allocation !== undefined) return { wires, ...allocation };
		// Family nesting can close a column dependency cycle absent from the original wires.
		// Split an unresolved departure, rather than dropping its endpoint-family precedence.
		const divided = moving.find((wire) => {
			if (wire.middle !== undefined || wire.source === wire.target) return false;
			return defined(wire.last).remaining > 0;
		});
		if (divided === undefined) throw new Error('Unresolved channel routing constraint cycle');
		familyBreaks ??= new Set<ChannelWire>();
		familyBreaks.add(divided);
	}
}

/** Share traverses at a common port, preserve distinct nets, then color transverse runs. */
export function routeChannel(input: readonly ChannelEndpoint[], ownerId?: string): ChannelRouting {
	const wires: ChannelWire[] = input.map((endpoint) => ({
		...endpoint,
		first: undefined,
		last: undefined,
		middle: undefined,
	}));
	return routeOwnedChannel(wires, false, ownerId);
}
