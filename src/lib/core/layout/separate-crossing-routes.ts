import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LayoutDirection } from '../document/logic-document';
import { isVerticalDirection } from './component-layout';
import type { Bounds, LayoutRelation, Point } from './layout-types';

interface CorridorRoute {
	readonly relation: LayoutRelation;
	readonly source: Bounds;
	readonly target: Bounds;
	readonly start: Point;
	readonly end: Point;
	readonly sourceCross: number;
	readonly targetCross: number;
	sourcePort: number;
	targetPort: number;
}

function hasInversion(routes: readonly CorridorRoute[]): boolean {
	let previousMaximum = Number.NEGATIVE_INFINITY;
	let groupMaximum = Number.NEGATIVE_INFINITY;
	let previousSource = Number.NEGATIVE_INFINITY;
	for (const route of routes) {
		if (route.sourceCross !== previousSource) {
			previousMaximum = Math.max(previousMaximum, groupMaximum);
			previousSource = route.sourceCross;
		}
		if (route.targetCross < previousMaximum) return true;
		groupMaximum = Math.max(groupMaximum, route.targetCross);
	}
	return false;
}

function compareRoutes(a: CorridorRoute, b: CorridorRoute): number {
	const sourceOrder = a.sourceCross - b.sourceCross;
	const targetOrder = a.targetCross - b.targetCross;
	return sourceOrder || targetOrder || compareCanonicalStrings(a.relation.id, b.relation.id);
}

/** Disjoint transverse intervals belong to independent routing corridors. */
function clusters(routes: readonly CorridorRoute[]): readonly CorridorRoute[][] {
	const sorted = [...routes].sort(
		(a, b) =>
			Math.min(a.sourceCross, a.targetCross) - Math.min(b.sourceCross, b.targetCross) ||
			compareRoutes(a, b),
	);
	const result: CorridorRoute[][] = [];
	let right = Number.NEGATIVE_INFINITY;
	let current: CorridorRoute[] = [];
	for (const route of sorted) {
		const left = Math.min(route.sourceCross, route.targetCross);
		if (left > right) {
			current = [];
			result.push(current);
		}
		current.push(route);
		right = Math.max(right, route.sourceCross, route.targetCross);
	}
	return result;
}

function primary(point: Point, vertical: boolean): number {
	if (vertical) return point.y;
	return point.x;
}

function cross(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function at(primaryCoordinate: number, crossCoordinate: number, vertical: boolean): Point {
	if (vertical) return { x: crossCoordinate, y: primaryCoordinate };
	return { x: primaryCoordinate, y: crossCoordinate };
}

function endpointFor(route: CorridorRoute, outgoing: boolean): string {
	if (outgoing) return route.relation.from;
	return route.relation.to;
}

function portOffsets(routes: readonly CorridorRoute[], vertical: boolean, outgoing: boolean): void {
	const byEndpoint = new Map<string, CorridorRoute[]>();
	for (const route of routes) {
		const endpoint = endpointFor(route, outgoing);
		const adjacent = byEndpoint.get(endpoint) ?? [];
		adjacent.push(route);
		byEndpoint.set(endpoint, adjacent);
	}
	for (const adjacent of byEndpoint.values()) {
		adjacent.sort((a, b) => {
			let order = a.sourceCross - b.sourceCross;
			if (outgoing) order = a.targetCross - b.targetCross;
			return order || compareCanonicalStrings(a.relation.id, b.relation.id);
		});
		const first = defined(adjacent[0]);
		let box = first.target;
		if (outgoing) box = first.source;
		let extent = box.height;
		if (vertical) extent = box.width;
		// Distinct source/target spreads prevent opposite diagonals sharing their end legs.
		let preferredSpacing = 36;
		if (outgoing) preferredSpacing = 12;
		const available = Math.max(0, extent - Math.min(12, extent / 2));
		const spacing = Math.min(preferredSpacing, available / Math.max(1, adjacent.length - 1));
		const centerIndex = (adjacent.length - 1) / 2;
		for (const [index, route] of adjacent.entries()) {
			const offset = (index - centerIndex) * spacing;
			if (outgoing) route.sourcePort = route.sourceCross + offset;
			else route.targetPort = route.targetCross + offset;
		}
	}
}

/** Keep incoming legs off outgoing legs, including differently sized endpoints. */
function distinctTargetOffsets(routes: readonly CorridorRoute[], vertical: boolean): void {
	portOffsets(routes, vertical, false);
	const sources = new Set<number>();
	const targets = new Set<number>();
	for (const route of routes) {
		sources.add(route.sourcePort);
		targets.add(route.targetPort);
	}
	const collisions = [...targets].filter((coordinate) => sources.has(coordinate));
	if (collisions.length === 0) return;
	const coordinates = [...new Set([...sources, ...targets])].sort((a, b) => a - b);
	const next = new Map<number, number>();
	for (const [index, coordinate] of coordinates.entries()) {
		if (sources.has(coordinate) && targets.has(coordinate)) {
			next.set(coordinate, coordinates[index + 1] ?? Number.POSITIVE_INFINITY);
		}
	}

	for (const route of routes) {
		const coordinate = route.targetPort;
		if (!sources.has(coordinate)) continue;
		let edge = route.target.y + route.target.height;
		if (vertical) edge = route.target.x + route.target.width;
		const limit = Math.min(edge, defined(next.get(coordinate)));
		const availableGap = limit - coordinate;
		route.targetPort = coordinate + availableGap / 2;
	}
}

function separateCluster(
	routes: readonly CorridorRoute[],
	vertical: boolean,
): ReadonlyMap<LayoutRelation, readonly Point[]> {
	const sorted = [...routes].sort(compareRoutes);
	const result = new Map<LayoutRelation, readonly Point[]>();
	if (!hasInversion(sorted)) return result;
	portOffsets(sorted, vertical, true);
	distinctTargetOffsets(sorted, vertical);
	const forward =
		primary(defined(sorted[0]).start, vertical) < primary(defined(sorted[0]).end, vertical);
	const starts = sorted.map(({ start }) => primary(start, vertical));
	const ends = sorted.map(({ end }) => primary(end, vertical));
	let corridorStart = Math.min(...starts);
	let corridorEnd = Math.max(...ends);
	if (forward) {
		corridorStart = Math.max(...starts);
		corridorEnd = Math.min(...ends);
	}
	for (const [index, route] of sorted.entries()) {
		const sourceCross = route.sourcePort;
		const targetCross = route.targetPort;
		const primaryStart = primary(route.start, vertical);
		const primaryEnd = primary(route.end, vertical);
		const fraction = (index + 1) / (sorted.length + 1);
		const middle = corridorStart + (corridorEnd - corridorStart) * fraction;
		const start = at(primaryStart, sourceCross, vertical);
		const end = at(primaryEnd, targetCross, vertical);
		const firstBend = at(middle, sourceCross, vertical);
		const secondBend = at(middle, targetCross, vertical);
		result.set(route.relation, [start, firstBend, secondBend, end]);
	}
	return result;
}

/** Coordinate ordinary-node routes only where their source/target order is inverted.
 * Other corridors, including non-crossing fans and group/junction attachments, retain their routes.
 */
interface CrossingRoutingInput {
	readonly relations: readonly LayoutRelation[];
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly direction: LayoutDirection;
	readonly excludedEndpoints: ReadonlySet<string>;
	readonly ranks: ReadonlyMap<string, number>;
}

export function separateCrossingRoutes({
	relations,
	bounds,
	direction,
	excludedEndpoints,
	ranks,
}: CrossingRoutingInput): LayoutRelation[] {
	const vertical = isVerticalDirection(direction);
	const corridors = new Map<number, Map<number, CorridorRoute[]>>();
	for (const relation of relations) {
		if (excludedEndpoints.has(relation.from) || excludedEndpoints.has(relation.to)) continue;
		const start = defined(relation.points.at(0));
		const end = defined(relation.points.at(-1));
		const sourceRank = defined(ranks.get(relation.from));
		const targetRank = defined(ranks.get(relation.to));
		const byTargetRank = corridors.get(sourceRank) ?? new Map<number, CorridorRoute[]>();
		corridors.set(sourceRank, byTargetRank);
		const routes = byTargetRank.get(targetRank) ?? [];
		byTargetRank.set(targetRank, routes);
		routes.push({
			relation,
			source: defined(bounds.get(relation.from)),
			target: defined(bounds.get(relation.to)),
			start,
			end,
			sourceCross: cross(start, vertical),
			targetCross: cross(end, vertical),
			sourcePort: cross(start, vertical),
			targetPort: cross(end, vertical),
		});
	}
	const separated = new Map<LayoutRelation, readonly Point[]>();
	for (const routes of [...corridors.values()].flatMap((byRank) => [...byRank.values()])) {
		for (const cluster of clusters(routes)) {
			for (const [id, points] of separateCluster(cluster, vertical)) separated.set(id, points);
		}
	}
	return relations.map((relation) => {
		const points = separated.get(relation);
		if (points === undefined) return relation;
		return { id: relation.id, from: relation.from, to: relation.to, points };
	});
}
