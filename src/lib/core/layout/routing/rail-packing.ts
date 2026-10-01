import { defined } from '../../document/logic-document';
import type { GraphEndpoint } from '../../graph/create-graph';
import { RAIL_SPACING } from '../layout-settings';
import type { ChannelRun, ChannelWire } from './channel-types';

enum FamilyField {
	Source = 'sourceEndpoint',
	Target = 'targetEndpoint',
}

/** A shared traverse belongs to a family only when every owner has that endpoint. */
function endpointFamilies(wires: readonly ChannelWire[], field: FamilyField): ChannelWire[][] {
	const owners = new Map<ChannelRun, GraphEndpoint | undefined>();
	for (const wire of wires) {
		const segment = defined(wire.last);
		const endpoint = wire[field];
		if (!owners.has(segment)) owners.set(segment, endpoint);
		else if (owners.get(segment) !== endpoint) owners.set(segment, undefined);
	}
	const families = new Map<GraphEndpoint, ChannelWire[]>();
	for (const wire of wires) {
		const endpoint = wire[field];
		if (endpoint === undefined || wire.source === wire.target) continue;
		if (owners.get(defined(wire.last)) !== endpoint) continue;
		const family = families.get(endpoint);
		if (family === undefined) families.set(endpoint, [wire]);
		else family.push(wire);
	}
	return [...families.values()];
}

function nestFamily(family: ChannelWire[], field: FamilyField): void {
	family.sort((a, b) => {
		const direction = Math.sign(a.target - a.source) - Math.sign(b.target - b.source);
		if (direction !== 0) return direction;
		const sign = Math.sign(a.target - a.source);
		if (field === FamilyField.Source) return sign * (b.target - a.target);
		return sign * (b.source - a.source);
	});
	// A shared traverse can occur at both ends of the port order: order it once, not cyclically.
	const seen = new Set<ChannelRun>();
	let count = 0;
	for (const wire of family) {
		const run = defined(wire.last);
		if (seen.has(run)) continue;
		seen.add(run);
		family[count++] = wire;
	}
	family.length = count;
	for (let index = 1; index < family.length; index += 1) {
		const previous = defined(family[index - 1]);
		const wire = defined(family[index]);
		if (Math.sign(previous.target - previous.source) !== Math.sign(wire.target - wire.source))
			continue;
		const first = defined(previous.last);
		const last = defined(wire.last);
		if (first === last) continue;
		const departure = previous.middle ?? previous.source;
		const targetCrosses = first.start < wire.target && wire.target < first.end;
		const sourceCrosses = last.start < departure && departure < last.end;
		const wireDeparture = wire.middle ?? wire.source;
		const forwardTargetCrosses = last.start < previous.target && previous.target < last.end;
		const forwardSourceCrosses = first.start < wireDeparture && wireDeparture < first.end;
		const reverseCost = Number(targetCrosses) + Number(sourceCrosses);
		const forwardCost = Number(forwardTargetCrosses) + Number(forwardSourceCrosses);
		// Nested spans caused by passage ports cross once in either order; precedence cannot help.
		if (reverseCost <= forwardCost) continue;
		first.next.push(last);
		last.remaining += 1;
	}
}

/** Families on one side nest before coloring, including the arrival runs of split wires. */
export function nestChannelEndpointRuns(wires: readonly ChannelWire[]): void {
	for (const field of [FamilyField.Source, FamilyField.Target])
		for (const family of endpointFamilies(wires, field)) nestFamily(family, field);
}

/** Insert only if both neighbours leave the strict half-spacing clearance. */
function insertRun(occupied: ChannelRun[], run: ChannelRun): boolean {
	let low = 0;
	let high = occupied.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (defined(occupied[middle]).start < run.start) low = middle + 1;
		else high = middle;
	}
	const before = occupied[low - 1];
	const after = occupied[low];
	const beforeEnd = before?.end ?? -Infinity;
	const beforeLimit = beforeEnd + RAIL_SPACING / 2;
	const endLimit = run.end + RAIL_SPACING / 2;
	const beforeClear = beforeLimit < run.start;
	const afterClear = after === undefined || endLimit < after.start;
	if (!beforeClear || !afterClear) return false;
	occupied.splice(low, 0, run);
	return true;
}

function placeRun(rails: ChannelRun[][], run: ChannelRun, minimum: number): number {
	for (let rail = minimum; ; rail += 1) {
		const occupied = rails[rail];
		if (occupied === undefined) {
			rails[rail] = [run];
			return rail;
		}
		if (insertRun(occupied, run)) return rail;
	}
}

/** Reuse disjoint rails across depths without reversing any established precedence. */
export function compactChannelRails(
	runs: readonly ChannelRun[],
	tracks: Map<number, number>,
): number {
	const minimum = new Int32Array(runs.length);
	const rails: ChannelRun[][] = [];
	for (const run of [...runs].sort((a, b) => a.rail - b.rail || a.start - b.start)) {
		const rail = placeRun(rails, run, defined(minimum[run.key]));
		run.rail = rail;
		tracks.set(run.key, rail);
		for (const next of run.next) minimum[next.key] = Math.max(defined(minimum[next.key]), rail + 1);
	}
	return rails.length;
}
