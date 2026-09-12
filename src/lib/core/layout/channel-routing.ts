import { defined } from '../document/logic-document';
import { packRails, type RailRun } from './rail-packing';

export interface ChannelEndpoint {
	readonly id: string;
	readonly source: number;
	readonly target: number;
}
export interface ChannelWire extends ChannelEndpoint {
	first: ChannelRun | undefined;
	last: ChannelRun | undefined;
	middle: number | undefined;
}
interface ChannelRun extends RailRun {
	readonly next: ChannelRun[];
	remaining: number;
	depth: number;
}
export interface ChannelRouting {
	readonly wires: readonly ChannelWire[];
	readonly railCount: number;
}

/** A coincident departure must leave its column before another wire arrives there. */
function cycleBreaks(wires: readonly ChannelWire[]): Set<ChannelWire> {
	const byTarget = new Map<number, ChannelWire>();
	for (const wire of wires) byTarget.set(wire.target, wire);
	const visited = new Map<ChannelWire, number>();
	let traversal = 0;
	const breaks = new Set<ChannelWire>();
	for (const start of wires) {
		if (visited.has(start)) continue;
		traversal += 1;
		let wire: ChannelWire | undefined = start;
		while (wire !== undefined && !visited.has(wire)) {
			visited.set(wire, traversal);
			wire = byTarget.get(wire.source);
		}
		if (wire !== undefined && visited.get(wire) === traversal) breaks.add(wire);
	}
	return breaks;
}

function run(source: number, target: number): ChannelRun {
	return {
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

function makeRuns(wires: readonly ChannelWire[]): ChannelRun[] {
	const breaks = cycleBreaks(wires);
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

function assignRails(runs: readonly ChannelRun[]): number {
	const ready = runs.filter((segment) => segment.remaining === 0);
	const layers: ChannelRun[][] = [];
	for (const segment of ready) {
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
	for (const layer of layers) count += packRails(layer, count);
	return count;
}

/** Exclusive source and target quays: break column cycles, then color transverse runs. */
export function routeChannel(input: readonly ChannelEndpoint[]): ChannelRouting {
	const wires: ChannelWire[] = input.map(({ id, source, target }) => ({
		id,
		source,
		target,
		first: undefined,
		last: undefined,
		middle: undefined,
	}));
	const moving = wires
		.filter((wire) => wire.source !== wire.target)
		.sort((a, b) => a.source - b.source);
	const runs = makeRuns(moving);
	const bySource = new Map<number, ChannelWire>();
	for (const wire of moving) bySource.set(wire.source, wire);
	for (const wire of moving) {
		const departure = bySource.get(wire.target);
		if (departure !== undefined) precedes(defined(departure.first), defined(wire.last));
	}
	return { wires, railCount: assignRails(runs) };
}
