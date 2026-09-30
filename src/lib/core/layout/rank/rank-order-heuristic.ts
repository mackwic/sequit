import { defined } from '../../document/logic-document';
import { groupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import { throughJunctions } from '../structure/relation-adjacency';
import type { RankOrder } from './rank-order';
import type { RankOrderDomain } from './rank-ordering';
import { SweepRows } from './sweep-rows';

interface SweepInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
}

interface Neighbour {
	readonly id: string;
	/** The neighbour is the relation's target. */
	readonly outgoing: boolean;
}

interface SweepContext {
	readonly structure: LayoutStructure;
	readonly neighbours: ReadonlyMap<string, readonly Neighbour[]>;
	readonly rows: SweepRows;
	readonly rank: number;
	readonly reverse: boolean;
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
	pulls: number[],
	context: SweepContext,
	neighbour: Neighbour,
	inside: ReadonlySet<string> = new Set(),
): void {
	const { structure, rows } = context;
	let ends: Iterable<string> = [neighbour.id];
	if (structure.junctionIds.has(neighbour.id)) {
		let edges = structure.graph.predecessorsByEndpointId;
		if (neighbour.outgoing) edges = structure.graph.outgoingByEndpointId;
		ends = throughJunctions(neighbour.id, edges, structure.junctionIds);
	}
	for (const end of ends) {
		const rank = rows.ranks.get(end);
		if (rank === undefined || inside.has(end)) continue;
		if (placed(context, rank)) pulls.push(defined(rows.positions.get(end)));
	}
}

/**
 * A block is rigid across its rows: it stays where it stands in the adjacent row already placed,
 * and the relations crossing its frame pull it, from any descendant. Its own position there
 * weighs as much as one relation.
 */
function blockPulls(context: SweepContext, block: string, inside: ReadonlySet<string>): number[] {
	const pulls: number[] = [];
	for (const member of inside)
		for (const neighbour of context.neighbours.get(member) ?? [])
			if (!inside.has(neighbour.id)) addNeighbour(pulls, context, neighbour, inside);
	let adjacent = context.rank - 1;
	if (context.reverse) adjacent = context.rank + 1;
	const spanned = context.rows.blockPosition(block, adjacent);
	if (spanned !== undefined) pulls.push(spanned);
	return pulls;
}

/**
 * The mean of the pulls, summed in ascending order: the same neighbours give the same target
 * whatever the order of the relations, so relation ids never break a tie. An item without a
 * placed neighbour keeps its current position.
 */
function targetPosition(
	context: SweepContext,
	id: string,
	inside: ReadonlySet<string> | undefined,
): number {
	let pulls: number[] = [];
	if (inside === undefined)
		for (const neighbour of context.neighbours.get(id) ?? [])
			addNeighbour(pulls, context, neighbour);
	else pulls = blockPulls(context, id, inside);
	if (pulls.length > 0)
		return (
			pulls.sort((left, right) => left - right).reduce((sum, pull) => sum + pull, 0) / pulls.length
		);
	if (inside === undefined) return defined(context.rows.positions.get(id));
	return defined(context.rows.blockPosition(id, context.rank));
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
 * by its neighbours in the rows already placed; a row is measured again when its band changes.
 * Successive sweeps share the relations, the blocks' members and the measured rows.
 */
export class BarycentricSweeper {
	private readonly neighbours: ReadonlyMap<string, readonly Neighbour[]>;
	private readonly members: ReadonlyMap<string, ReadonlySet<string>>;
	private readonly documentary: readonly ReadonlyMap<string, number>[];
	private rows: SweepRows | undefined;

	constructor(private readonly input: SweepInput) {
		this.neighbours = relationNeighbours(input.structure);
		this.members = blockMembers(input.structure, input.domain.bands);
		this.documentary = input.domain.bands.map(
			(band) => new Map(band.map((id, position) => [id, position])),
		);
	}

	sweep(order: RankOrder, reverse: boolean): RankOrder {
		const { structure, domain } = this.input;
		const bands = order.map((band) => [...band]);
		const indices = bands.map((_, index) => index);
		if (reverse) indices.reverse();
		const rows = this.rows ?? new SweepRows(structure, domain, bands);
		this.rows = rows;
		rows.update(bands);
		for (const index of indices) {
			const row = defined(bands[index]);
			const { rank } = defined(domain.locations[index]);
			const context = { structure, neighbours: this.neighbours, rows, rank, reverse };
			const targets = new Map(
				row.map((id) => [id, targetPosition(context, id, this.members.get(id))]),
			);
			const documentary = defined(this.documentary[index]);
			const sorted = row.toSorted(
				(left, right) =>
					defined(targets.get(left)) - defined(targets.get(right)) ||
					defined(documentary.get(left)) - defined(documentary.get(right)),
			);
			if (sorted.every((id, position) => id === row[position])) continue;
			bands[index] = sorted;
			rows.update(bands);
		}
		return bands;
	}
}

export function barycentricSweep(input: SweepInput, order: RankOrder, reverse: boolean): RankOrder {
	return new BarycentricSweeper(input).sweep(order, reverse);
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
