import type { LogicRelation } from '../../document/logic-document';
import { defined } from '../../document/logic-document';
import { groupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import { throughJunctions } from '../structure/relation-adjacency';
import type { RankOrder } from './rank-order';
import type { RankOrderDomain } from './rank-ordering';

interface SweepInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
}

interface Barycentre {
	sum: number;
	count: number;
}

interface Reach {
	readonly positions: ReadonlyMap<string, number>;
	readonly structure: LayoutStructure;
}

function addPosition(total: Barycentre, position: number | undefined): void {
	total.sum += position ?? 0;
	total.count += Number(position !== undefined);
}

/**
 * A relation contributes the position of its other endpoint. Junctions have no slot in the
 * bands: an unplaced junction stands for the endpoints beyond it, on the same side.
 */
function addNeighbour(total: Barycentre, neighbour: string, forward: boolean, reach: Reach): void {
	const { positions, structure } = reach;
	const position = positions.get(neighbour);
	if (position !== undefined || !structure.junctionIds.has(neighbour)) {
		addPosition(total, position);
		return;
	}
	let edges = structure.graph.predecessorsByEndpointId;
	if (forward) edges = structure.graph.outgoingByEndpointId;
	for (const beyond of throughJunctions(neighbour, edges, structure.junctionIds))
		addPosition(total, positions.get(beyond));
}

function connectedAverage(
	id: string,
	relations: readonly LogicRelation[],
	reach: Reach,
): Barycentre {
	const total = { sum: 0, count: 0 };
	for (const { from, to } of relations) {
		if (from === id) addNeighbour(total, to, true, reach);
		else if (to === id) addNeighbour(total, from, false, reach);
	}
	return total;
}

function compareBarycentres(
	left: string,
	right: string,
	averages: ReadonlyMap<string, Barycentre>,
	documentaryPosition: ReadonlyMap<string, number>,
): number {
	const a = defined(averages.get(left));
	const b = defined(averages.get(right));
	const leftWeighted = a.sum * (b.count || 1);
	const rightWeighted = b.sum * (a.count || 1);
	const barycentre = leftWeighted - rightWeighted;
	if (barycentre !== 0) return barycentre;
	// Documentary positions are unique within a band. Equality here means the same ID,
	// for which a further canonical-ID comparison would also be zero.
	return defined(documentaryPosition.get(left)) - defined(documentaryPosition.get(right));
}

/** A block's barycentre averages the relations crossing its frame, from any descendant. */
function blockAverage(
	inside: ReadonlySet<string>,
	relations: readonly LogicRelation[],
	reach: Reach,
): Barycentre {
	const total = { sum: 0, count: 0 };
	for (const { from, to } of relations) {
		const fromInside = inside.has(from);
		if (fromInside === inside.has(to)) continue;
		if (fromInside) addNeighbour(total, to, true, reach);
		else addNeighbour(total, from, false, reach);
	}
	return total;
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

/** A sweep uses only already placed neighbouring ranks; unresolved neighbours do not bias a row. */
export function barycentricSweep(input: SweepInput, order: RankOrder, reverse: boolean): RankOrder {
	const bands = order.map((band) => [...band]);
	const positions = new Map<string, number>();
	for (const band of bands)
		for (const [position, id] of band.entries()) positions.set(id, position);
	const indices = bands.map((_, index) => index);
	if (reverse) indices.reverse();
	const relations = input.structure.graph.relations.map(({ relation }) => relation);
	const members = blockMembers(input.structure, order);
	for (const index of indices) {
		const row = defined(bands[index]);
		const documentary = defined(input.domain.bands[index]);
		const documentaryPosition = new Map(documentary.map((id, position) => [id, position]));
		const reach = { positions, structure: input.structure };
		const averages = new Map(
			row.map((id) => {
				const inside = members.get(id);
				if (inside === undefined) return [id, connectedAverage(id, relations, reach)] as const;
				return [id, blockAverage(inside, relations, reach)] as const;
			}),
		);
		row.sort((left, right) => compareBarycentres(left, right, averages, documentaryPosition));
		for (const [position, id] of row.entries()) positions.set(id, position);
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
