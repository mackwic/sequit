import type { LayoutRelation, Point } from '../../projection/layout-graph';
import { clusterColors } from './route-color-clusters';
import { DEFAULT_ROUTE_PALETTE, type RoutePalette } from './route-color-palette';

// Distinguish only parallel routes close enough to be visually confused.
export const PARALLEL_COLOR_DISTANCE = 24;

interface ColorSegment {
	readonly start: Point;
	readonly end: Point;
}

enum SegmentAxis {
	X = 'x',
	Y = 'y',
}

/** Nearby parallel portions need different ink only when their longitudinal spans overlap. */
export function parallelSegmentsAreClose(first: ColorSegment, second: ColorSegment): boolean {
	let axis = SegmentAxis.X;
	let cross = SegmentAxis.Y;
	if (first.start.x === first.end.x) {
		axis = SegmentAxis.Y;
		cross = SegmentAxis.X;
	}
	if (first.start[cross] !== first.end[cross]) return false;
	if (second.start[cross] !== second.end[cross]) return false;
	const distance = Math.abs(first.start[cross] - second.start[cross]);
	if (distance > PARALLEL_COLOR_DISTANCE) return false;
	const start = Math.max(
		Math.min(first.start[axis], first.end[axis]),
		Math.min(second.start[axis], second.end[axis]),
	);
	const end = Math.min(
		Math.max(first.start[axis], first.end[axis]),
		Math.max(second.start[axis], second.end[axis]),
	);
	return start < end;
}

enum TrunkSide {
	Outgoing = 'outgoing',
	Incoming = 'incoming',
}

function endpointPort(relation: LayoutRelation, side: TrunkSide) {
	let points = relation.points;
	let endpoint = relation.from;
	if (side === TrunkSide.Incoming) {
		points = points.toReversed();
		endpoint = relation.to;
	}
	const start = points.at(0);
	if (start === undefined) return undefined;
	const next = points.find((point) => point.x !== start.x || point.y !== start.y);
	if (next === undefined) return undefined;
	const horizontal = Math.sign(next.x - start.x);
	const vertical = Math.sign(next.y - start.y);
	if (horizontal !== 0 && vertical !== 0) return undefined;
	return { endpoint, side, start, horizontal, vertical };
}

function portKeys(relation: LayoutRelation): readonly string[] {
	return [TrunkSide.Outgoing, TrunkSide.Incoming].flatMap((side) => {
		const port = endpointPort(relation, side);
		if (port === undefined) return [];
		return [JSON.stringify(port)];
	});
}

function intersects(previous: ReadonlySet<string>, family: ReadonlySet<string>): boolean {
	return [...previous].some((member) => family.has(member));
}

function mergeFamilies(families: Map<string, Set<string>>, family: Set<string>): void {
	for (const [key, previous] of families) {
		if (intersects(previous, family)) families.set(key, family);
	}
}

function familyConflicts(
	byId: ReadonlyMap<string, Set<string>>,
	contacts: readonly (readonly [string, string])[],
) {
	const conflicts = new Map<Set<string>, Set<Set<string>>>();
	for (const [first, second] of contacts) {
		const a = byId.get(first);
		const b = byId.get(second);
		if (a === undefined || b === undefined) continue;
		if (a === b) continue;
		for (const [family, neighbor] of [
			[a, b],
			[b, a],
		] as const) {
			const adjacent = conflicts.get(family) ?? new Set<Set<string>>();
			adjacent.add(neighbor);
			conflicts.set(family, adjacent);
		}
	}
	return conflicts;
}

/** A continuous shared trunk keeps one ink; crossing or nearby independent families differ. */
function routeFamilies(relations: readonly LayoutRelation[]) {
	const families = new Map<string, Set<string>>();
	const byId = new Map<string, Set<string>>();
	const ordered = [...relations].sort((left, right) => {
		return Number(left.id > right.id) - Number(left.id < right.id);
	});
	for (const relation of ordered) {
		const keys = portKeys(relation);
		const family = new Set([relation.id]);
		for (const key of keys) {
			for (const member of families.get(key) ?? []) family.add(member);
		}
		mergeFamilies(families, family);
		for (const key of keys) families.set(key, family);
		for (const member of family) byId.set(member, family);
	}
	return byId;
}

/** Opposite faces of one node: equal transverse coordinate and opposite outward tangents. */
function continuities(
	relations: readonly LayoutRelation[],
): readonly (readonly [string, string])[] {
	const outgoing = new Map<string, string[]>();
	for (const relation of relations) {
		const port = endpointPort(relation, TrunkSide.Outgoing);
		if (port === undefined) continue;
		const key = continuityKey(port, 1);
		const ids = outgoing.get(key) ?? [];
		ids.push(relation.id);
		outgoing.set(key, ids);
	}
	return relations.flatMap((relation) => {
		const port = endpointPort(relation, TrunkSide.Incoming);
		if (port === undefined) return [];
		return (outgoing.get(continuityKey(port, -1)) ?? []).map((id): readonly [string, string] => [
			relation.id,
			id,
		]);
	});
}

function continuityKey(port: NonNullable<ReturnType<typeof endpointPort>>, sign: number): string {
	let transverse = port.start.y;
	if (port.horizontal === 0) transverse = port.start.x;
	return JSON.stringify([port.endpoint, transverse, port.horizontal * sign, port.vertical * sign]);
}

/** Shared trunks are one unit; contact components receive a local round-robin palette. */
export function relationColors(
	relations: readonly LayoutRelation[],
	contacts: readonly (readonly [string, string])[] = [],
	palette: RoutePalette = DEFAULT_ROUTE_PALETTE,
): ReadonlyMap<string, string> {
	const byId = routeFamilies(relations);
	const colors = clusterColors({
		families: [...new Set(byId.values())],
		contacts: familyConflicts(byId, contacts),
		continuities: familyConflicts(byId, continuities(relations)),
		palette,
	});
	return new Map([...byId].map(([id, family]) => [id, colors.get(family) ?? palette[0]]));
}
