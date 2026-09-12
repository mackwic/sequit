import { compareCanonicalStrings } from '../canonical-string';
import { defined, EndpointKind, type LogicRelation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { Bounds } from './layout-types';

export interface CorridorLink {
	readonly relation: LogicRelation;
	readonly source: number;
	readonly target: number;
}
export interface RoutingCorridor {
	readonly rank: number;
	readonly links: readonly CorridorLink[];
}

export function crossCenter(box: Bounds, vertical: boolean): number {
	if (vertical) return box.x + box.width / 2;
	return box.y + box.height / 2;
}

function compareLinks(a: CorridorLink, b: CorridorLink): number {
	const source = a.source - b.source;
	const target = a.target - b.target;
	return source || target || compareCanonicalStrings(a.relation.id, b.relation.id);
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

function inverted(links: readonly CorridorLink[]): boolean {
	if (neighborInversion(links)) return true;
	let previousSource = Number.NEGATIVE_INFINITY;
	let previousMaximum = Number.NEGATIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const link of [...links].sort(compareLinks)) {
		if (link.source !== previousSource) {
			previousMaximum = maximum;
			previousSource = link.source;
		}
		if (link.target < previousMaximum) return true;
		maximum = Math.max(maximum, link.target);
	}
	return false;
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

/** Adjacent ordinary-node corridors; group and junction attachments retain their own geometry. */
export function crossingCorridors(input: {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly bounds: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
}): RoutingCorridor[] {
	const byRank = new Map<number, CorridorLink[]>();
	for (const { relation, source, target } of input.graph.relations) {
		if (source.kind !== EndpointKind.Node || target.kind !== EndpointKind.Node) continue;
		const rank = defined(input.ranks.get(relation.to));
		if (input.ranks.get(relation.from) !== rank + 1) continue;
		const links = byRank.get(rank) ?? [];
		links.push({
			relation,
			source: crossCenter(defined(input.bounds.get(relation.from)), input.vertical),
			target: crossCenter(defined(input.bounds.get(relation.to)), input.vertical),
		});
		byRank.set(rank, links);
	}
	const result: RoutingCorridor[] = [];
	for (const [rank, links] of byRank) {
		for (const cluster of intersectingClusters(links)) {
			if (inverted(cluster)) result.push({ rank, links: cluster });
		}
	}
	return result;
}
