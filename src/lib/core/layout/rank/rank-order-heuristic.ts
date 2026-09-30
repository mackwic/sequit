import { defined } from '../../document/logic-document';
import { groupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import { throughJunctions } from '../structure/relation-adjacency';
import type { RankOrder } from './rank-order';
import { applyRankOrder, type RankOrderDomain } from './rank-ordering';
import { topologyRows, transversePositions } from './transverse-positions';

interface SweepInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
}

interface Barycentre {
	sum: number;
	count: number;
}

interface Neighbour {
	readonly id: string;
	/** The neighbour is the relation's target. */
	readonly outgoing: boolean;
}

/** An applied order in the topology oracle's coordinates, with the rank of every row item. */
interface RowModel {
	readonly positions: ReadonlyMap<string, number>;
	readonly ranks: ReadonlyMap<string, number>;
	/** Positions of each block's descendants, by rank. */
	readonly blocks: ReadonlyMap<string, ReadonlyMap<number, Barycentre>>;
}

interface SweepContext {
	readonly structure: LayoutStructure;
	readonly neighbours: ReadonlyMap<string, readonly Neighbour[]>;
	readonly model: RowModel;
	readonly rank: number;
	readonly reverse: boolean;
}

function addPosition(total: Barycentre, position: number): void {
	total.sum += position;
	total.count += 1;
}

/** Relations as effective endpoint pairs, parallel relations counted once each. */
function relationNeighbours(structure: LayoutStructure): ReadonlyMap<string, readonly Neighbour[]> {
	const neighbours = new Map<string, Neighbour[]>();
	const add = (id: string, neighbour: Neighbour): void => {
		const list = neighbours.get(id) ?? [];
		list.push(neighbour);
		neighbours.set(id, list);
	};
	const link = (source: string, target: string): void => {
		if (source === target) return;
		add(source, { id: target, outgoing: true });
		add(target, { id: source, outgoing: false });
	};
	for (const { sourceIds, targetIds } of structure.graph.effectiveRelations)
		for (const source of sourceIds) for (const target of targetIds) link(source, target);
	return neighbours;
}

function addToBlocks(
	totals: Map<string, Map<number, Barycentre>>,
	parentOf: (id: string) => string | undefined,
	id: string,
	at: { readonly rank: number; readonly position: number },
): void {
	for (let block = parentOf(id); block !== undefined; block = parentOf(block)) {
		const byRank = totals.get(block) ?? new Map<number, Barycentre>();
		totals.set(block, byRank);
		const total = byRank.get(at.rank) ?? { sum: 0, count: 0 };
		byRank.set(at.rank, total);
		addPosition(total, at.position);
	}
}

/** Flat rows of the applied order: members stand inline, a block where its descendants are. */
function rowModel(input: SweepInput, order: RankOrder): RowModel {
	const applied = applyRankOrder(input.structure, input.domain, order);
	const positions = transversePositions(applied, topologyRows(applied));
	const { parentOf } = groupBlocks(input.structure.graph);
	const ranks = new Map<string, number>();
	const blocks = new Map<string, Map<number, Barycentre>>();
	for (const component of applied.components)
		for (const [rank, row] of component.rows.ordinary.entries())
			for (const id of row) {
				ranks.set(id, rank);
				addToBlocks(blocks, parentOf, id, { rank, position: defined(positions.get(id)) });
			}
	return { positions, ranks, blocks };
}

/** Only rows the sweep has already placed pull an item; the row being sorted never does. */
function placed(context: SweepContext, rank: number): boolean {
	if (context.reverse) return rank > context.rank;
	return rank < context.rank;
}

/**
 * A relation contributes the position of its other endpoint. Junctions have no slot in the
 * bands: a junction stands for the endpoints beyond it, on the same side.
 */
function addNeighbour(
	total: Barycentre,
	context: SweepContext,
	neighbour: Neighbour,
	inside: ReadonlySet<string> = new Set(),
): void {
	const { structure, model } = context;
	let ends: Iterable<string> = [neighbour.id];
	if (structure.junctionIds.has(neighbour.id)) {
		let edges = structure.graph.predecessorsByEndpointId;
		if (neighbour.outgoing) edges = structure.graph.outgoingByEndpointId;
		ends = throughJunctions(neighbour.id, edges, structure.junctionIds);
	}
	for (const end of ends) {
		const rank = model.ranks.get(end);
		if (rank === undefined || inside.has(end)) continue;
		if (placed(context, rank)) addPosition(total, defined(model.positions.get(end)));
	}
}

function blockPosition(model: RowModel, block: string, rank: number): number | undefined {
	const total = model.blocks.get(block)?.get(rank);
	if (total === undefined) return undefined;
	return total.sum / total.count;
}

/**
 * A block is rigid across its rows: it stays where it stands in the adjacent row already placed,
 * and the relations crossing its frame pull it, from any descendant.
 */
function blockBarycentre(
	context: SweepContext,
	block: string,
	inside: ReadonlySet<string>,
): Barycentre {
	const total = { sum: 0, count: 0 };
	for (const member of inside)
		for (const neighbour of context.neighbours.get(member) ?? [])
			if (!inside.has(neighbour.id)) addNeighbour(total, context, neighbour, inside);
	let adjacent = context.rank - 1;
	if (context.reverse) adjacent = context.rank + 1;
	const spanned = blockPosition(context.model, block, adjacent);
	if (spanned !== undefined) addPosition(total, spanned);
	return total;
}

/** An item without a placed neighbour keeps its current position. */
function targetPosition(
	context: SweepContext,
	id: string,
	inside: ReadonlySet<string> | undefined,
): number {
	let total = { sum: 0, count: 0 };
	if (inside === undefined)
		for (const neighbour of context.neighbours.get(id) ?? [])
			addNeighbour(total, context, neighbour);
	else total = blockBarycentre(context, id, inside);
	if (total.count > 0) return total.sum / total.count;
	if (inside === undefined) return defined(context.model.positions.get(id));
	return defined(blockPosition(context.model, id, context.rank));
}

/** Endpoints inside each block of the bands, the block included; other blocks are not visited. */
function blockMembers(
	structure: LayoutStructure,
	order: RankOrder,
): ReadonlyMap<string, ReadonlySet<string>> {
	const blocks = groupBlocks(structure.graph);
	const members = new Map<string, Set<string>>();
	const banded = order.flat().filter((id) => blocks.ids.has(id));
	if (banded.length === 0) return members;
	const children = new Map<string, string[]>();
	for (const id of new Set([...structure.graph.rankableEndpointIds, ...blocks.ids])) {
		const parent = blocks.parentOf(id);
		if (parent === undefined) continue;
		const list = children.get(parent) ?? [];
		list.push(id);
		children.set(parent, list);
	}
	for (const block of banded) {
		const inside = new Set([block]);
		const pending = [block];
		for (let next = pending.pop(); next !== undefined; next = pending.pop())
			for (const child of children.get(next) ?? []) {
				inside.add(child);
				pending.push(child);
			}
		members.set(block, inside);
	}
	return members;
}

/**
 * Every band is sorted in the flat rows of the component, the topology oracle's coordinates,
 * by its neighbours in the rows already placed; the rows are measured again after each change.
 */
export function barycentricSweep(input: SweepInput, order: RankOrder, reverse: boolean): RankOrder {
	const bands = order.map((band) => [...band]);
	const indices = bands.map((_, index) => index);
	if (reverse) indices.reverse();
	const neighbours = relationNeighbours(input.structure);
	const members = blockMembers(input.structure, order);
	let model = rowModel(input, bands);
	for (const index of indices) {
		const row = defined(bands[index]);
		const { rank } = defined(input.domain.locations[index]);
		const context = { structure: input.structure, neighbours, model, rank, reverse };
		const targets = new Map(row.map((id) => [id, targetPosition(context, id, members.get(id))]));
		const documentary = new Map(
			defined(input.domain.bands[index]).map((id, position) => [id, position]),
		);
		const sorted = row.toSorted(
			(left, right) =>
				defined(targets.get(left)) - defined(targets.get(right)) ||
				defined(documentary.get(left)) - defined(documentary.get(right)),
		);
		if (sorted.every((id, position) => id === row[position])) continue;
		bands[index] = sorted;
		model = rowModel(input, bands);
	}
	return bands;
}

export function* adjacentOrders(order: RankOrder): IterableIterator<RankOrder> {
	for (const [bandIndex, band] of order.entries()) {
		for (let index = 0; index + 1 < band.length; index += 1) {
			const next = order.map((part) => [...part]);
			const row = defined(next[bandIndex]);
			[row[index], row[index + 1]] = [defined(row[index + 1]), defined(row[index])];
			yield next;
		}
	}
}
