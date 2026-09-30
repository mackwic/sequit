import { compareCanonicalStrings } from '../../canonical-string';
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

enum RunSide {
	First = 'first',
	Last = 'last',
}

function hasSharedEndpoint(wire: ChannelEndpoint): boolean {
	return wire.sharedSource !== undefined || wire.sharedTarget !== undefined;
}

interface CycleFrame {
	readonly wire: ChannelWire;
	next: number;
}

/**
 * A coincident departure must leave its column before another wire arrives there. Several
 * wires may arrive at one column, so these constraints form a general graph: a depth-first
 * search breaks the wire closing each cycle, following the latest arrival first.
 */
function cycleBreaks(wires: readonly ChannelWire[]): Set<ChannelWire> {
	const arrivals = new Map<number, ChannelWire[]>();
	for (const wire of wires) {
		const column = arrivals.get(wire.target) ?? [];
		column.push(wire);
		arrivals.set(wire.target, column);
	}
	// True while a wire is on the search path, false once its descendants are explored.
	const active = new Map<ChannelWire, boolean>();
	const breaks = new Set<ChannelWire>();
	for (const start of wires) {
		if (active.has(start)) continue;
		active.set(start, true);
		const path: CycleFrame[] = [{ wire: start, next: 0 }];
		for (let frame = path.at(-1); frame !== undefined; frame = path.at(-1)) {
			const following = arrivals.get(frame.wire.source)?.at(-1 - frame.next);
			frame.next += 1;
			if (following === undefined) {
				active.set(frame.wire, false);
				path.pop();
			} else if (active.get(following) === true) breaks.add(following);
			else if (!active.has(following)) {
				active.set(following, true);
				path.push({ wire: following, next: 0 });
			}
		}
	}
	return breaks;
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

function makeRuns(
	wires: readonly ChannelWire[],
	sharedEndpoints: boolean,
	nonInverted: boolean,
): ChannelRun[] {
	let moving = wires;
	if (sharedEndpoints) moving = wires.filter((wire) => wire.source !== wire.target);
	let breaks: Set<ChannelWire>;
	if (sharedEndpoints) {
		// Shared endpoint families can turn independent column dependencies into a cycle.
		// Leave coincident columns first, then join the shared arrival traverse.
		const targets = new Set(wires.map((wire) => wire.target));
		breaks = new Set(moving.filter((wire) => targets.has(wire.source)));
	} else if (nonInverted) breaks = new Set();
	else breaks = cycleBreaks(moving);
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
): ChannelRailAllocation {
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
	if (ready.length !== runs.length) throw new Error('Unresolved channel routing constraint cycle');
	let count = 0;
	const edge = { ownerId, capacity: runs.length, spacing: RAIL_SPACING };
	const trackByRunKey = new Map<number, number>();
	for (const layer of layers) {
		count += allocateChannelIntervals(edge, layer, count, trackByRunKey).trackCount;
	}
	edge.capacity = count;
	untangleChannelRails(wires, runs, trackByRunKey);
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
		.sort((a, b) => {
			const difference = a.source - b.source || a.target - b.target;
			return difference || compareCanonicalStrings(a.id, b.id);
		});
	const arrivals = mergeRuns(
		moving,
		makeRuns(moving, sharedEndpoints, nonInverted),
		RunSide.Last,
		sharedEndpoints,
	);
	const runs = mergeRuns(moving, arrivals, RunSide.First, sharedEndpoints);
	const bySource = new Map<number, ChannelWire[]>();
	for (const wire of moving) {
		const departures = bySource.get(wire.source) ?? [];
		departures.push(wire);
		bySource.set(wire.source, departures);
	}
	for (const wire of moving) {
		// A straight wire keeps one column across the channel: it neither leaves nor reaches it on
		// a traverse, so only the wires that turn there order their runs.
		if (wire.source === wire.target) continue;
		for (const departure of bySource.get(wire.target) ?? []) {
			if (departure.source === departure.target) continue;
			if (departure.first !== wire.last) precedes(defined(departure.first), defined(wire.last));
		}
	}
	return { wires, ...assignRails(runs, moving, ownerId) };
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
