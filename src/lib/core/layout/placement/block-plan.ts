import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { COMPONENT_GAP, ITEM_GAP } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import { type GroupBlocks, groupBlocks, itemIn } from '../structure/group-blocks';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import { weaklyConnectedComponents } from '../structure/layout-components';
import type { PlacementRows } from '../structure/placement-rows';
import { type FamilyLinks, flatFamilyLinks } from './align-families';

/** The graph and group measurements families and blocks follow, independent of any one row. */
export interface FamilyContext {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly groups: ReadonlyMap<string, GroupMeasurement>;
	readonly junctionIds: ReadonlySet<string>;
}

interface RankSpan {
	readonly first: number;
	readonly last: number;
}

/** The root, or one block, laid out as rows of its direct items. */
export interface ContainerPlan {
	readonly id: string | undefined;
	readonly rows: readonly (readonly string[])[];
	readonly links: FamilyLinks;
}

export interface BlockPlan {
	readonly blocks: GroupBlocks;
	/** Innermost containers first: a block is complete before its container places it. */
	readonly containers: readonly ContainerPlan[];
	readonly spans: ReadonlyMap<string, RankSpan>;
	/** Everything a block carries when it moves: its descendants and nested frames. */
	readonly contents: ReadonlyMap<string, readonly string[]>;
	/** Relation-connected clusters an item belongs to; disjoint neighbors keep the component gap. */
	readonly clusters: ReadonlyMap<string, ReadonlySet<number>>;
}

interface RawAdjacency {
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly children: ReadonlyMap<string, readonly string[]>;
}

const plans = new WeakMap<PlacementRows, BlockPlan>();
const adjacencies = new WeakMap<LogicGraph, RawAdjacency>();

/** Relations as documented: a relation to a group reaches its frame, not its members. */
function rawAdjacency(graph: LogicGraph): RawAdjacency {
	const cached = adjacencies.get(graph);
	if (cached !== undefined) return cached;
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	for (const { relation } of graph.relations) {
		parents.set(relation.from, [...(parents.get(relation.from) ?? []), relation.to]);
		children.set(relation.to, [...(children.get(relation.to) ?? []), relation.from]);
	}
	const adjacency = { parents, children };
	adjacencies.set(graph, adjacency);
	return adjacency;
}

/** Related ordinary endpoints, looking through junctions. */
function throughJunctions(
	id: string,
	edges: ReadonlyMap<string, readonly string[]>,
	junctionIds: ReadonlySet<string>,
): ReadonlySet<string> {
	const found = new Set<string>();
	const seen = new Set<string>();
	const pending = [...(edges.get(id) ?? [])];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		if (junctionIds.has(next)) pending.push(...(edges.get(next) ?? []));
		else found.add(next);
	}
	return found;
}

function blockSpans(rows: PlacementRows, blocks: GroupBlocks): ReadonlyMap<string, RankSpan> {
	const spans = new Map<string, RankSpan>();
	for (const [rank, row] of rows.ordinary.entries())
		for (const id of row)
			for (const block of blocks.chainOf(id)) {
				const span = spans.get(block) ?? { first: rank, last: rank };
				spans.set(block, { first: Math.min(span.first, rank), last: Math.max(span.last, rank) });
			}
	return spans;
}

function containerRows(
	rows: PlacementRows,
	blocks: GroupBlocks,
	container: string | undefined,
): readonly (readonly string[])[] {
	return rows.ordinary.map((row) => {
		const items: string[] = [];
		for (const id of row) {
			if (container !== undefined && !blocks.chainOf(id).includes(container)) continue;
			const item = itemIn(blocks, container, id);
			if (items.at(-1) !== item) items.push(item);
		}
		return items;
	});
}

interface MutableLinks {
	readonly down: Map<string, string[]>[];
	readonly up: Map<string, string[]>[];
	readonly upAnchors: Map<string, string[]>[];
}

function addLink(
	links: Map<string, string[]>[],
	rank: number,
	item: string,
	related: string,
): void {
	const byItem = defined(links[rank]);
	const list = byItem.get(item) ?? [];
	if (!list.includes(related)) list.push(related);
	byItem.set(item, list);
}

interface LinkContext {
	readonly blocks: GroupBlocks;
	readonly spans: ReadonlyMap<string, RankSpan>;
	readonly ranks: ReadonlyMap<string, number>;
	readonly linksOf: (container: string | undefined) => MutableLinks;
}

function rangeOf(context: LinkContext, id: string): RankSpan | undefined {
	const span = context.spans.get(id);
	if (span !== undefined) return span;
	const rank = context.ranks.get(id);
	if (rank === undefined) return undefined;
	return { first: rank, last: rank };
}

/**
 * A relation belongs to the innermost container holding both endpoints: there, each endpoint
 * stands for the item enclosing it. The relation links the child's first row to the parent's
 * last row only when they are adjacent.
 */
function addRelation(context: LinkContext, child: string, parent: string): void {
	const childRange = rangeOf(context, child);
	const parentRange = rangeOf(context, parent);
	if (childRange === undefined || parentRange === undefined) return;
	if (childRange.first !== parentRange.last + 1) return;
	const childChain = context.blocks.chainOf(child);
	const parentChain = context.blocks.chainOf(parent);
	if (childChain.includes(parent) || parentChain.includes(child)) return;
	let depth = 0;
	while (depth < childChain.length && childChain[depth] === parentChain[depth]) depth += 1;
	const container = childChain[depth - 1];
	const links = context.linksOf(container);
	addLink(links.down, childRange.first, childChain[depth] ?? child, parent);
	const parentItem = parentChain[depth] ?? parent;
	addLink(links.up, parentRange.last, parentItem, child);
	addLink(links.upAnchors, parentRange.last, parentItem, parent);
}

function blockLinks(
	rows: PlacementRows,
	context: FamilyContext,
	input: { readonly blocks: GroupBlocks; readonly spans: ReadonlyMap<string, RankSpan> },
): ReadonlyMap<string | undefined, FamilyLinks> {
	const byContainer = new Map<string | undefined, MutableLinks>();
	const empty = () => rows.ordinary.map(() => new Map<string, string[]>());
	const linksOf = (container: string | undefined): MutableLinks => {
		const known = byContainer.get(container);
		if (known !== undefined) return known;
		const links = { down: empty(), up: empty(), upAnchors: empty() };
		byContainer.set(container, links);
		return links;
	};
	const linkContext = { ...input, ranks: context.ranks, linksOf };
	const { parents } = rawAdjacency(context.graph);
	for (const child of [...rows.ordinary.flat(), ...input.spans.keys()])
		for (const parent of throughJunctions(child, parents, context.junctionIds))
			addRelation(linkContext, child, parent);
	return byContainer;
}

function contentsOf(
	rows: PlacementRows,
	blocks: GroupBlocks,
	spans: ReadonlyMap<string, RankSpan>,
): ReadonlyMap<string, readonly string[]> {
	const contents = new Map<string, string[]>();
	for (const id of [...rows.ordinary.flat(), ...spans.keys()])
		for (const block of blocks.chainOf(id))
			contents.set(block, [...(contents.get(block) ?? []), id]);
	return contents;
}

/** Weak components of the relations alone: a block may gather several of them. */
function clustersOf(
	graph: LogicGraph,
	contents: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, ReadonlySet<number>> {
	const clusters = new Map<string, Set<number>>();
	for (const [index, ids] of weaklyConnectedComponents(graph).entries())
		for (const id of ids) clusters.set(id, new Set([index]));
	for (const [block, ids] of contents) {
		const union = clusters.get(block) ?? new Set<number>();
		for (const id of ids) for (const index of clusters.get(id) ?? []) union.add(index);
		clusters.set(block, union);
	}
	return clusters;
}

export function blockPlan(rows: PlacementRows, context: FamilyContext): BlockPlan {
	const cached = plans.get(rows);
	if (cached !== undefined) return cached;
	const blocks = groupBlocks(context.graph);
	const spans = blockSpans(rows, blocks);
	let plan: BlockPlan;
	if (spans.size === 0) {
		const links = flatFamilyLinks({
			rows: rows.ordinary,
			parents: context.graph.outgoingByEndpointId,
			children: context.graph.predecessorsByEndpointId,
			junctionIds: context.junctionIds,
		});
		plan = {
			blocks,
			containers: [{ id: undefined, rows: rows.ordinary, links }],
			spans,
			contents: new Map(),
			clusters: new Map(),
		};
	} else {
		const links = blockLinks(rows, context, { blocks, spans });
		const nested = [...spans.keys()].toSorted(
			(left, right) =>
				blocks.chainOf(right).length - blocks.chainOf(left).length ||
				compareCanonicalStrings(left, right),
		);
		const containers = [...nested, undefined].map((id) => ({
			id,
			rows: containerRows(rows, blocks, id),
			links: links.get(id) ?? { down: [], up: [] },
		}));
		const contents = contentsOf(rows, blocks, spans);
		plan = { blocks, containers, spans, contents, clusters: clustersOf(context.graph, contents) };
	}
	plans.set(rows, plan);
	return plan;
}

/** Unrelated neighbors stay as far apart as separate components. */
export function gapBetween(plan: BlockPlan, left: string, right: string): number {
	const leftClusters = plan.clusters.get(left);
	const rightClusters = plan.clusters.get(right);
	if (leftClusters === undefined || rightClusters === undefined) return ITEM_GAP;
	for (const index of leftClusters) if (rightClusters.has(index)) return ITEM_GAP;
	return COMPONENT_GAP;
}
