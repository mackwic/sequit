import { defined } from '../../document/logic-document';
import type { GraphEndpoint } from '../../graph/create-graph';
import { RAIL_SPACING } from '../layout-settings';
import { countChannelCrossings } from './channel-crossing-cost';
import type { ChannelEndpoint, ChannelRun, ChannelWire } from './channel-types';

export function hasSharedEndpoint(wire: ChannelEndpoint): boolean {
	return wire.sharedSource !== undefined || wire.sharedTarget !== undefined;
}

enum FamilyField {
	Source = 'sourceEndpoint',
	Target = 'targetEndpoint',
}
const FAMILY_FIELDS = [FamilyField.Source, FamilyField.Target] as const;

/** A shared traverse belongs to a family only when every owner has that endpoint. */
function endpointFamilies(
	wires: readonly ChannelWire[],
	field: FamilyField,
): Iterable<ChannelWire[]> {
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
	return families.values();
}

function orderFamily(family: ChannelWire[], field: FamilyField): void {
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
}

function improvesFamilyOrder(previous: ChannelWire, wire: ChannelWire): boolean {
	if (Math.sign(previous.target - previous.source) !== Math.sign(wire.target - wire.source))
		return false;
	const first = defined(previous.last);
	const last = defined(wire.last);
	const departure = previous.middle ?? previous.source;
	const targetCrosses = first.start < wire.target && wire.target < first.end;
	const sourceCrosses = last.start < departure && departure < last.end;
	const wireDeparture = wire.middle ?? wire.source;
	const forwardTargetCrosses = last.start < previous.target && previous.target < last.end;
	const forwardSourceCrosses = first.start < wireDeparture && wireDeparture < first.end;
	const reverseCost = Number(targetCrosses) + Number(sourceCrosses);
	const forwardCost = Number(forwardTargetCrosses) + Number(forwardSourceCrosses);
	return reverseCost > forwardCost;
}

function familyIsCrossed(family: ChannelWire[], field: FamilyField): boolean {
	orderFamily(family, field);
	for (let index = 1; index < family.length; index += 1) {
		const previous = defined(family[index - 1]);
		const wire = defined(family[index]);
		if (
			defined(previous.last).rail > defined(wire.last).rail &&
			improvesFamilyOrder(previous, wire)
		)
			return true;
	}
	return false;
}

/** Do not disturb a channel whose existing endpoint families already pass without crossings. */
export function hasCrossedChannelFamilies(wires: readonly ChannelWire[]): boolean {
	for (const field of FAMILY_FIELDS)
		for (const family of endpointFamilies(wires, field))
			if (familyIsCrossed(family, field)) return true;
	return false;
}

function nestFamily(family: ChannelWire[], field: FamilyField): void {
	orderFamily(family, field);
	for (let index = 1; index < family.length; index += 1) {
		const previous = defined(family[index - 1]);
		const wire = defined(family[index]);
		if (!improvesFamilyOrder(previous, wire)) continue;
		const first = defined(previous.last);
		const last = defined(wire.last);
		first.next.push(last);
		last.remaining += 1;
	}
}

/** Families on one side nest before coloring, including the arrival runs of split wires. */
export function nestChannelEndpointRuns(wires: readonly ChannelWire[]): void {
	for (const field of FAMILY_FIELDS)
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

/** Reuse disjoint rails in topological visitation order, without reversing precedence. */
function compactChannelRails(runs: readonly ChannelRun[]): number {
	const minimum = new Int32Array(runs.length);
	const rails: ChannelRun[][] = [];
	for (const run of runs) {
		const rail = placeRun(rails, run, defined(minimum[run.key]));
		run.rail = rail;
		for (const next of run.next) minimum[next.key] = Math.max(defined(minimum[next.key]), rail + 1);
	}
	return rails.length;
}

interface PackedChannelRails {
	readonly railCount: number;
	readonly crossings: number;
}

/** Price both bounded packings: crossings first, then corridor capacity; retain the untangled tie. */
export function packChannelRails(
	runs: readonly ChannelRun[],
	wires: readonly ChannelWire[],
): PackedChannelRails {
	const ordered = [...runs].sort((a, b) => a.rail - b.rail || a.start - b.start);
	const orderedCount = compactChannelRails(ordered);
	const orderedCost = countChannelCrossings(wires, orderedCount);
	const orderedRails = new Int32Array(runs.length);
	for (const run of runs) orderedRails[run.key] = run.rail;
	const topologicalCount = compactChannelRails(runs);
	const topologicalCost = countChannelCrossings(wires, topologicalCount);
	let preferTopological = topologicalCost < orderedCost;
	if (topologicalCost === orderedCost) preferTopological = topologicalCount < orderedCount;
	if (preferTopological) return { railCount: topologicalCount, crossings: topologicalCost };
	for (const run of runs) run.rail = defined(orderedRails[run.key]);
	return { railCount: orderedCount, crossings: orderedCost };
}

/** Capture only the owned bindings needed to restore a rejected nested plan. */
export function preserveChannelRunBindings(wires: readonly ChannelWire[]): () => void {
	const first = wires.map((wire) => wire.first);
	const last = wires.map((wire) => wire.last);
	const middle = wires.map((wire) => wire.middle);
	return () => {
		for (let index = 0; index < wires.length; index += 1) {
			const wire = defined(wires[index]);
			wire.first = first[index];
			wire.last = last[index];
			wire.middle = middle[index];
		}
	};
}
