import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { COMPONENT_GAP, ITEM_GAP } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import { commonContainer, type GroupBlocks, groupBlocks } from '../structure/group-blocks';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import { weaklyConnectedComponents } from '../structure/layout-components';
import type { PlacementRows } from '../structure/placement-rows';
import { type FamilyLinks, flatFamilyLinks } from './align-families';
import { blockSpans, type ContainerRows, containerRowsOf, type RankSpan } from './container-rows';

/** The graph and group measurements families and blocks follow, independent of any one row. */
export interface FamilyContext {
	readonly graph: LogicGraph;
	readonly ranks: ReadonlyMap<string, number>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly groups: ReadonlyMap<string, GroupMeasurement>;
	readonly junctionIds: ReadonlySet<string>;
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
	/** Direct row items and nested blocks a block carries when it moves. */
	readonly children: ReadonlyMap<string, readonly string[]>;
	/** Relation-connected clusters an item belongs to; disjoint neighbors keep the component gap. */
	readonly clusters: ReadonlyMap<string, readonly number[]>;
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
	const add = (edges: Map<string, string[]>, from: string, to: string): void => {
		const list = edges.get(from) ?? [];
		list.push(to);
		edges.set(from, list);
	};
	for (const { relation } of graph.relations) {
		add(parents, relation.from, relation.to);
		add(children, relation.to, relation.from);
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
	return byContainer;
}

function childrenOf(
	rows: PlacementRows,
	blocks: GroupBlocks,
	spans: ReadonlyMap<string, RankSpan>,
): ReadonlyMap<string, readonly string[]> {
	const children = new Map<string, string[]>();
	for (const block of spans.keys()) children.set(block, []);
	for (const id of [...rows.ordinary.flat(), ...spans.keys()]) {
		const block = blocks.parentOf(id);
		if (block !== undefined) defined(children.get(block)).push(id);
	}
	return children;
}

/**
 * Weak components of the relations alone: a block may gather several of them. A block joins
 * the clusters of its children, nested blocks first.
 */
function clustersOf(
	graph: LogicGraph,
	children: ReadonlyMap<string, readonly string[]>,
	innermostFirst: readonly string[],
): ReadonlyMap<string, readonly number[]> {
	const clusters = new Map<string, readonly number[]>();
	for (const [index, ids] of weaklyConnectedComponents(graph).entries())
		for (const id of ids) clusters.set(id, [index]);
	for (const block of innermostFirst) {
		const union = new Set(clusters.get(block));
		for (const id of children.get(block) ?? [])
			for (const index of clusters.get(id) ?? []) union.add(index);
		clusters.set(block, [...union]);
	}
	return clusters;
}

export function blockPlan(rows: PlacementRows, context: FamilyContext): BlockPlan {
	const cached = plans.get(rows);
	if (cached !== undefined) return cached;
	const blocks = groupBlocks(context.graph);
	const blockOrder = blockSpans(rows, blocks);
	const { spans, innermostFirst } = blockOrder;
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
			clusters: new Map(),
		};
	} else {
		const containerRows = containerRowsOf(rows, blocks, blockOrder);
		const links = blockLinks(rows, context, { blocks, spans, rows: containerRows });
		const containers = [...innermostFirst, undefined].map((id) => ({
			id,
			...defined(containerRows.get(id)),
			links: links.get(id) ?? { down: [], up: [] },
		}));
		const children = childrenOf(rows, blocks, spans);
		const clusters = clustersOf(context.graph, children, innermostFirst);
		plan = { blocks, containers, spans, children, clusters };
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
