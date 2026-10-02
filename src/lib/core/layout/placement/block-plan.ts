import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { COMPONENT_GAP, ITEM_GAP } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import { commonContainer, type GroupBlocks, groupBlocks } from '../structure/group-blocks';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import type { JunctionPlacement } from '../structure/junction-structure';
import { relationComponentIndex } from '../structure/layout-components';
import type { PlacementRows } from '../structure/placement-rows';
import { rawAdjacency, throughJunctions } from '../structure/relation-adjacency';
import { type FamilyLinks, flatFamilyLinks } from './align-families';
import {
	type BlockSpans,
	blockSpans,
	type ContainerRows,
	containerRowsOf,
	type RankSpan,
	type RelatedAbove,
} from './container-rows';
import { freeGroups, freeMembers } from './free-groups';

/** The graph and group measurements families and blocks follow, independent of any one row. */
export interface FamilyContext {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly groups: ReadonlyMap<string, GroupMeasurement>;
	readonly junctionIds: ReadonlySet<string>;
	readonly junctions: ReadonlyMap<string, JunctionPlacement>;
}

/** The root, or one block, laid out as rows of its direct items; links follow its rows. */
export interface ContainerPlan extends ContainerRows {
	readonly id: string | undefined;
	readonly links: FamilyLinks;
}

export interface BlockPlan {
	readonly blocks: GroupBlocks;
	/** Innermost containers first: a block is complete before its container places it. */
	readonly containers: readonly ContainerPlan[];
	readonly spans: ReadonlyMap<string, RankSpan>;
	/** Direct row items, nested blocks and free groups a block carries when it moves. */
	readonly children: ReadonlyMap<string, readonly string[]>;
	/** Free groups standing beside each block's content, in documentary order. */
	readonly free: ReadonlyMap<string, readonly string[]>;
	/** Relation-connected clusters an item belongs to; disjoint neighbors keep the component gap. */
	readonly clusters: ReadonlyMap<string, readonly number[]>;
}

const plans = new WeakMap<PlacementRows, BlockPlan>();
const NO_BLOCKS: BlockSpans = { spans: new Map(), occupied: new Map(), innermostFirst: [] };

interface MutableLinks {
	readonly down: Map<string, string[]>[];
	readonly up: Map<string, string[]>[];
	readonly upAnchors: Map<string, string[]>[];
}

function addLink(
	links: Map<string, string[]>[],
	index: number,
	item: string,
	related: string,
): void {
	const byItem = defined(links[index]);
	const list = byItem.get(item) ?? [];
	if (!list.includes(related)) list.push(related);
	byItem.set(item, list);
}

interface LinkInput {
	readonly blocks: GroupBlocks;
	readonly spans: ReadonlyMap<string, RankSpan>;
	readonly rows: ReadonlyMap<string | undefined, ContainerRows>;
}

interface LinkContext extends LinkInput {
	readonly ranks: ReadonlyMap<string, number>;
	readonly linksOf: (container: string | undefined) => MutableLinks;
}

function spans(context: LinkContext, item: string, rank: number): boolean {
	const span = context.spans.get(item);
	if (span === undefined) return false;
	return span.first <= rank && rank <= span.last;
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
	const common = commonContainer(context.blocks, child, parent);
	if (common === undefined) return;
	const { container, left: childItem, right: parentItem } = common;
	// A block standing in the other endpoint's row is beside it, not above or below it.
	if (spans(context, childItem, parentRange.last) || spans(context, parentItem, childRange.first))
		return;
	const { indexOf } = defined(context.rows.get(container));
	const links = context.linksOf(container);
	// A block has no row where it is alone in the middle of its span: it is a wall there.
	const childIndex = indexOf.get(childRange.first);
	if (childIndex !== undefined) addLink(links.down, childIndex, childItem, parent);
	const parentIndex = indexOf.get(parentRange.last);
	if (parentIndex === undefined) return;
	addLink(links.up, parentIndex, parentItem, child);
	addLink(links.upAnchors, parentIndex, parentItem, parent);
}

function blockLinks(
	rows: PlacementRows,
	context: FamilyContext,
	input: LinkInput,
): ReadonlyMap<string | undefined, FamilyLinks> {
	const byContainer = new Map<string | undefined, MutableLinks>();
	const linksOf = (container: string | undefined): MutableLinks => {
		const known = byContainer.get(container);
		if (known !== undefined) return known;
		const { length } = defined(input.rows.get(container)).rows;
		const empty = () => Array.from({ length }, () => new Map<string, string[]>());
		const links = { down: empty(), up: empty(), upAnchors: empty() };
		byContainer.set(container, links);
		return links;
	};
	const linkContext = { ...input, ranks: context.ranks, linksOf };
	const { parents } = rawAdjacency(context.graph);
	for (const child of [...rows.ordinary.flat(), ...input.spans.keys()])
		for (const parent of throughJunctions(child, parents, context.junctionIds))
			addRelation(linkContext, child, parent);
	return new Map([...byContainer].map(([container, links]) => [container, lookupOf(links)]));
}

function lookupOf(links: MutableLinks): FamilyLinks {
	return {
		related: (item, rank, sign) => {
			let byRank = links.up;
			if (sign > 0) byRank = links.down;
			return byRank[rank]?.get(item) ?? [];
		},
		upAnchors: (item, rank) => links.upAnchors[rank]?.get(item),
	};
}

const NO_LINKS: FamilyLinks = { related: () => [] };

/** Items of a container a row item relates to, looking through junctions; blocks carry none. */
function relatedItems(context: FamilyContext, blocks: GroupBlocks): RelatedAbove {
	const { parents, children } = rawAdjacency(context.graph);
	const itemFacing = (item: string, neighbor: string, container: string | undefined) => {
		const common = commonContainer(blocks, item, neighbor);
		if (common === undefined || common.container !== container) return [];
		return [common.right];
	};
	return (item, _rank, container) => {
		if (blocks.ids.has(item)) return [];
		return [parents, children].flatMap((edges) =>
			[...throughJunctions(item, edges, context.junctionIds)].flatMap((neighbor) =>
				itemFacing(item, neighbor, container),
			),
		);
	};
}

function childrenOf(
	rows: PlacementRows,
	blocks: GroupBlocks,
	spans: ReadonlyMap<string, RankSpan>,
	free: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
	const children = new Map<string, string[]>();
	for (const block of spans.keys()) children.set(block, []);
	for (const id of [...rows.ordinary.flat(), ...spans.keys()]) {
		const block = blocks.parentOf(id);
		if (block !== undefined) defined(children.get(block)).push(id);
	}
	for (const [block, groups] of free) defined(children.get(block)).push(...groups);
	return children;
}

/** Free groups of each block, nested ones included: a block carries them all when it moves. */
function freeOf(
	hierarchy: GroupHierarchy | undefined,
	ranks: ReadonlyMap<string, number>,
	spans: ReadonlyMap<string, RankSpan>,
): { readonly direct: Map<string, readonly string[]>; readonly carried: Map<string, string[]> } {
	const direct = new Map<string, readonly string[]>();
	const carried = new Map<string, string[]>();
	if (hierarchy === undefined) return { direct, carried };
	const free = freeGroups(hierarchy, ranks);
	for (const block of spans.keys()) {
		const members = freeMembers(hierarchy, free, block);
		if (members.length === 0) continue;
		direct.set(block, members);
		const subtree = [...members];
		for (const id of subtree) subtree.push(...(hierarchy.membersById.get(id) ?? []));
		carried.set(block, subtree);
	}
	return { direct, carried };
}

/**
 * Weak components of the relations alone: a block may gather several of them. A block joins
 * the clusters of its children, nested blocks first.
 */
function clustersOf(
	graph: LogicGraph,
	children: ReadonlyMap<string, readonly string[]>,
	input: { readonly ids: readonly string[]; readonly innermostFirst: readonly string[] },
): ReadonlyMap<string, readonly number[]> {
	const componentOf = relationComponentIndex(graph);
	const clusters = new Map<string, readonly number[]>();
	for (const id of input.ids) {
		const index = componentOf.get(id);
		if (index !== undefined) clusters.set(id, [index]);
	}
	const { innermostFirst } = input;
	for (const block of innermostFirst) {
		const union = new Set(clusters.get(block));
		for (const id of children.get(block) ?? [])
			for (const index of clusters.get(id) ?? []) union.add(index);
		clusters.set(block, [...union]);
	}
	return clusters;
}

const flatLinkCache = new WeakMap<PlacementRows, FamilyLinks>();

/** Links of rows without blocks: every endpoint its own item, cached with the rows. */
export function flatLinks(rows: PlacementRows, context: FamilyContext): FamilyLinks {
	const cached = flatLinkCache.get(rows);
	if (cached !== undefined) return cached;
	const links = flatFamilyLinks({
		rows: rows.ordinary,
		parents: context.graph.outgoingByEndpointId,
		children: context.graph.predecessorsByEndpointId,
		junctionIds: context.junctionIds,
	});
	flatLinkCache.set(rows, links);
	return links;
}

export function blockPlan(rows: PlacementRows, context: FamilyContext): BlockPlan {
	const cached = plans.get(rows);
	if (cached !== undefined) return cached;
	const blocks = groupBlocks(context.graph);
	let blockOrder: BlockSpans = NO_BLOCKS;
	if (blocks.ids.size > 0) blockOrder = blockSpans(rows, blocks, context.junctions);
	const { spans, innermostFirst } = blockOrder;
	let plan: BlockPlan;
	if (spans.size === 0) {
		const links = flatLinks(rows, context);
		plan = {
			blocks,
			containers: [
				{
					id: undefined,
					ranks: rows.ordinary.map((_, rank) => rank),
					rows: rows.ordinary,
					indexOf: new Map(),
					links,
				},
			],
			spans,
			children: new Map(),
			free: new Map(),
			clusters: new Map(),
		};
	} else {
		const containerRows = containerRowsOf(rows, blocks, blockOrder, relatedItems(context, blocks));
		const links = blockLinks(rows, context, { blocks, spans, rows: containerRows });
		const containers = [...innermostFirst, undefined].map((id) => ({
			id,
			...defined(containerRows.get(id)),
			links: links.get(id) ?? NO_LINKS,
		}));
		const free = freeOf(context.hierarchy, context.ranks, spans);
		const children = childrenOf(rows, blocks, spans, free.carried);
		const clusters = clustersOf(context.graph, children, {
			ids: [...rows.ordinary.flat(), ...spans.keys()],
			innermostFirst,
		});
		plan = { blocks, containers, spans, children, free: free.direct, clusters };
	}
	plans.set(rows, plan);
	return plan;
}

/** Unrelated neighbors stay as far apart as separate components. */
export function gapBetween(plan: BlockPlan, left: string, right: string): number {
	const leftClusters = plan.clusters.get(left);
	const rightClusters = plan.clusters.get(right);
	if (leftClusters === undefined || rightClusters === undefined) return ITEM_GAP;
	for (const index of leftClusters) if (rightClusters.includes(index)) return ITEM_GAP;
	return COMPONENT_GAP;
}
