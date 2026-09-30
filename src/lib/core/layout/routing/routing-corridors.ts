import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { transverseCenter } from '../geometry/layout-frame';
import type { Bounds } from '../layout-types';

export interface CorridorLink {
	readonly relation: LogicRelation;
	readonly source: number;
	readonly target: number;
	readonly relationIndex?: number;
}
const canonicalGraph = Symbol('canonical corridor graph');

export interface RoutingCorridor {
	readonly rank: number;
	readonly links: readonly CorridorLink[];
	readonly cornerOnly?: boolean;
	readonly [canonicalGraph]?: LogicGraph;
}

/** Only a corridor emitted from this canonical graph can address routes by relation index. */
export function corridorCarriesCanonicalIndexes(
	corridor: RoutingCorridor,
	graph: LogicGraph,
): boolean {
	return corridor[canonicalGraph] === graph;
}

/** Canonical crossing corridors of `graph` index every relation routed through them. */
export function corridorsIndexGraph(
	corridors: readonly RoutingCorridor[],
	graph: LogicGraph,
): boolean {
	if (corridors.length === 0) return false;
	return corridors.every((corridor) => corridorCarriesCanonicalIndexes(corridor, graph));
}

/** The link of `graph`'s relation at `relationIndex`, between its endpoint centers. */
export function corridorLink(
	relation: LogicRelation,
	relationIndex: number,
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): CorridorLink {
	return {
		relation,
		source: transverseCenter(defined(bounds.get(relation.from)), vertical),
		target: transverseCenter(defined(bounds.get(relation.to)), vertical),
		relationIndex,
	};
}

function compareLinks(a: CorridorLink, b: CorridorLink): number {
	const source = a.source - b.source;
	const target = a.target - b.target;
	return source || target || compareCanonicalStrings(a.relation.id, b.relation.id);
}

function intersectingClusters(links: readonly CorridorLink[]): CorridorLink[][] {
	const ordered = [...links].sort(
		(a, b) => Math.min(a.source, a.target) - Math.min(b.source, b.target) || compareLinks(a, b),
	);
	const groups: CorridorLink[][] = [];
	let right = Number.NEGATIVE_INFINITY;
	let current: CorridorLink[] = [];
	for (const link of ordered) {
		if (Math.min(link.source, link.target) > right) {
			current = [];
			groups.push(current);
		}
		current.push(link);
		right = Math.max(right, link.source, link.target);
	}
	return groups;
}

function neighborInversion(links: readonly CorridorLink[]): boolean {
	for (let index = 1; index < links.length; index += 1) {
		const a = defined(links[index - 1]);
		const b = defined(links[index]);
		const source = a.source - b.source;
		const target = a.target - b.target;
		if (source * target < 0) return true;
	}
	return false;
}

/** A link shared by a branch and a convergence cannot share both of its endpoint trunks. */
const noPartialBipartiteTargets: ReadonlySet<string> = new Set();

function partialBipartiteTargets(cluster: readonly CorridorLink[]): ReadonlySet<string> {
	if (cluster.length < 3) return noPartialBipartiteTargets;
	const targets = new Set<string>();
	const firstTargetBySource = new Map<string, string>();
	const firstSourceByTarget = new Map<string, string>();
	const branchingSources = new Set<string>();
	const convergingTargets = new Set<string>();
	const outgoingCounts = new Map<string, number>();
	const incomingCounts = new Map<string, number>();
	for (const { relation } of cluster) {
		outgoingCounts.set(relation.from, (outgoingCounts.get(relation.from) ?? 0) + 1);
		incomingCounts.set(relation.to, (incomingCounts.get(relation.to) ?? 0) + 1);
		const firstTarget = firstTargetBySource.get(relation.from);
		if (firstTarget === undefined) firstTargetBySource.set(relation.from, relation.to);
		else if (firstTarget !== relation.to) branchingSources.add(relation.from);
		const firstSource = firstSourceByTarget.get(relation.to);
		if (firstSource === undefined) firstSourceByTarget.set(relation.to, relation.from);
		else if (firstSource !== relation.from) convergingTargets.add(relation.to);
	}
	for (const { relation } of cluster) {
		const branch = branchingSources.has(relation.from) && outgoingCounts.get(relation.from) === 2;
		const join = convergingTargets.has(relation.to) && incomingCounts.get(relation.to) === 2;
		if (branch && join) targets.add(relation.to);
	}
	return targets;
}

/** Overlapping transverse runs need rail allocation even when they keep their rank order. */
function independentTurns(cluster: readonly CorridorLink[]): boolean {
	const turns = cluster.filter(({ source, target }) => source !== target);
	if (turns.length < 2) return false;
	const first = defined(turns[0]).relation;
	if (turns.every(({ relation }) => relation.from === first.from)) return false;
	if (turns.every(({ relation }) => relation.to === first.to)) return false;
	return true;
}

function collectCorridors(
	byRank: ReadonlyMap<number, CorridorLink[]>,
	graph: LogicGraph,
	canonicalIds: boolean,
): RoutingCorridor[] {
	const result: RoutingCorridor[] = [];
	for (const [rank, links] of byRank) {
		for (const cluster of intersectingClusters(links)) {
			// Interval-start ordering makes any source/target inversion visible between neighbors.
			const crossing = neighborInversion(cluster);
			const needsCorridor =
				crossing || independentTurns(cluster) || partialBipartiteTargets(cluster).size > 0;
			if (!needsCorridor) continue;
			let corridor: RoutingCorridor = { rank, links: cluster };
			if (!crossing) corridor = { rank, links: cluster, cornerOnly: true };
			if (canonicalIds) Object.defineProperty(corridor, canonicalGraph, { value: graph });
			result.push(corridor);
		}
	}
	return result;
}

/** Adjacent ordinary-node corridors; group and junction attachments retain their own geometry. */
export function crossingCorridors(input: {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
	readonly includeJunctions?: boolean;
}): RoutingCorridor[] {
	// Straight relations cannot invert their transverse order; no corridor needs allocation.
	const aligned = input.graph.relations.every(({ relation }) => {
		const source = defined(input.bounds.get(relation.from));
		const target = defined(input.bounds.get(relation.to));
		return transverseCenter(source, input.vertical) === transverseCenter(target, input.vertical);
	});
	if (aligned) return [];
	const byRank = new Map<number, CorridorLink[]>();
	let canonicalIds = true;
	let previousId: string | undefined;
	for (const [relationIndex, { relation, source, target }] of input.graph.relations.entries()) {
		if (previousId !== undefined && compareCanonicalStrings(previousId, relation.id) >= 0)
			canonicalIds = false;
		previousId = relation.id;
		if (source.kind === EndpointKind.Group || target.kind === EndpointKind.Group) continue;
		const hasJunction =
			source.kind === EndpointKind.Junction || target.kind === EndpointKind.Junction;
		if (hasJunction && input.includeJunctions !== true) continue;
		const rank = defined(input.ranks.get(relation.to));
		if (input.ranks.get(relation.from) !== rank + 1) continue;
		const links = byRank.get(rank) ?? [];
		links.push(corridorLink(relation, relationIndex, input.bounds, input.vertical));
		byRank.set(rank, links);
	}
	return collectCorridors(byRank, input.graph, canonicalIds);
}

interface CornerPortSharing {
	readonly sharedSources: ReadonlySet<string>;
	readonly sharedTargets: ReadonlySet<string>;
	readonly distinctTargets: ReadonlySet<string>;
}

function includePartialBipartiteTargets(
	corridors: readonly RoutingCorridor[],
	distinctTargets: Set<string>,
): void {
	for (const corridor of corridors)
		if (corridor.cornerOnly === true)
			for (const target of partialBipartiteTargets(corridor.links)) distinctTargets.add(target);
}

/** Keep shared endpoints of new non-inverted corridors unless a crossing already separates them. */
export function cornerPortSharing(
	corridors: readonly RoutingCorridor[],
): CornerPortSharing | undefined {
	if (!corridors.some(({ cornerOnly }) => cornerOnly === true)) return undefined;
	const sharedSources = new Set<string>();
	const sharedTargets = new Set<string>();
	const crossingSources = new Set<string>();
	const distinctTargets = new Set<string>();
	for (const corridor of corridors) {
		for (const { relation } of corridor.links) {
			if (corridor.cornerOnly === true) {
				sharedSources.add(relation.from);
				sharedTargets.add(relation.to);
			} else {
				crossingSources.add(relation.from);
				distinctTargets.add(relation.to);
			}
		}
	}
	for (const source of crossingSources) sharedSources.delete(source);
	includePartialBipartiteTargets(corridors, distinctTargets);
	for (const target of distinctTargets) sharedTargets.delete(target);
	return { sharedSources, sharedTargets, distinctTargets };
}
