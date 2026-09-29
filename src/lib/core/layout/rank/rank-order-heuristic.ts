import type { LogicRelation } from '../../document/logic-document';
import { defined } from '../../document/logic-document';
import { groupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { RankOrder } from './rank-order';
import type { RankOrderDomain } from './rank-ordering';

interface SweepInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
}

function neighbourPosition(
	id: string,
	from: string,
	to: string,
	positions: ReadonlyMap<string, number>,
): number | undefined {
	if (from === id) return positions.get(to);
	if (to === id) return positions.get(from);
	return undefined;
}

function connectedAverage(
	id: string,
	relations: readonly LogicRelation[],
	positions: ReadonlyMap<string, number>,
): { sum: number; count: number } {
	let sum = 0;
	let count = 0;
	for (const { from, to } of relations) {
		const position = neighbourPosition(id, from, to, positions);
		sum += position ?? 0;
		count += Number(position !== undefined);
	}
	return { sum, count };
}

function compareBarycentres(
	left: string,
	right: string,
	averages: ReadonlyMap<string, { sum: number; count: number }>,
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
	positions: ReadonlyMap<string, number>,
): { sum: number; count: number } {
	let sum = 0;
	let count = 0;
	for (const { from, to } of relations) {
		const fromInside = inside.has(from);
		if (fromInside === inside.has(to)) continue;
		let neighbour = from;
		if (fromInside) neighbour = to;
		const position = positions.get(neighbour);
		sum += position ?? 0;
		count += Number(position !== undefined);
	}
	return { sum, count };
}

function blockMembers(structure: LayoutStructure): ReadonlyMap<string, ReadonlySet<string>> {
	const blocks = groupBlocks(structure.graph);
	const members = new Map<string, Set<string>>();
	if (blocks.ids.size === 0) return members;
	for (const id of structure.graph.rankableEndpointIds)
		for (const block of blocks.chainOf(id)) {
			const inside = members.get(block) ?? new Set([block]);
			inside.add(id);
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
	const members = blockMembers(input.structure);
	for (const index of indices) {
		const row = defined(bands[index]);
		const documentary = defined(input.domain.bands[index]);
		const documentaryPosition = new Map(documentary.map((id, position) => [id, position]));
		const averages = new Map(
			row.map((id) => {
				const inside = members.get(id);
				if (inside === undefined) return [id, connectedAverage(id, relations, positions)] as const;
				return [id, blockAverage(inside, relations, positions)] as const;
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
