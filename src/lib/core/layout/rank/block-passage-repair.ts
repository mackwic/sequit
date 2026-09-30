import { defined } from '../../document/logic-document';
import type { LayoutStructure } from '../structure/prepare-layout';
import { type AdjacentRelation, type ClosedPassage, closedPassages } from './block-passages';
import type { RankOrder } from './rank-order';
import { applyRankOrder, type RankOrderDomain, repairBlockOrder } from './rank-ordering';

/** A repaired order, its rows, and whether a wall still closes a passage there. */
export interface ReopenedOrder {
	readonly order: RankOrder;
	readonly applied: LayoutStructure;
	readonly closed: boolean;
}

interface Inspection {
	readonly closed: boolean;
	/** The first closed passage, top down, not repaired yet. */
	readonly next: ClosedPassage | undefined;
}

function bandKey(componentIndex: number, rank: number, container: string | undefined): string {
	return `${componentIndex}\u0000${rank}\u0000${container ?? ''}`;
}

/** The band with the passage's item moved just past the walls it stands on the wrong side of. */
function besideWalls(band: readonly string[], passage: ClosedPassage): string[] | undefined {
	const at = band.indexOf(passage.item);
	if (at < 0) return undefined;
	const rest = band.filter((id) => id !== passage.item);
	let low = 0;
	let high = rest.length;
	for (const [index, id] of rest.entries()) {
		if (passage.before.has(id)) low = Math.max(low, index + 1);
		if (passage.after.has(id)) high = Math.min(high, index);
	}
	if (low > high) return undefined;
	rest.splice(Math.min(Math.max(at, low), high), 0, passage.item);
	return rest;
}

/**
 * Rows are ordered top down, as placement orders them: a lower endpoint that a wall separates
 * from its upper neighbour moves beside that wall, on its neighbour's side. Each relation is
 * repaired once; a block moved this way keeps its sibling order in every band.
 */
export class BlockPassageRepair {
	private readonly bands: ReadonlyMap<string, number>;
	private readonly rowOf = new Map<
		string,
		{ readonly componentIndex: number; readonly rank: number }
	>();
	private readonly topDown: readonly AdjacentRelation[];

	constructor(
		private readonly structure: LayoutStructure,
		private readonly domain: RankOrderDomain,
		relations: readonly AdjacentRelation[],
	) {
		this.bands = new Map(
			domain.locations.map((location, index) => [
				bandKey(location.componentIndex, location.rank, location.container),
				index,
			]),
		);
		for (const [componentIndex, component] of structure.components.entries())
			for (const [rank, row] of component.rows.ordinary.entries())
				for (const id of row) this.rowOf.set(id, { componentIndex, rank });
		this.topDown = relations.toSorted((left, right) => left.rank - right.rank);
	}

	reopen(order: RankOrder): ReopenedOrder {
		const repaired = new Set<AdjacentRelation>();
		let current = order;
		let applied = applyRankOrder(this.structure, this.domain, current);
		let inspection = this.inspect(applied, repaired);
		for (let passage = inspection.next; passage !== undefined; passage = inspection.next) {
			repaired.add(passage.relation);
			const moved = this.moved(current, passage);
			if (moved !== undefined) {
				current = moved;
				applied = applyRankOrder(this.structure, this.domain, current);
			}
			inspection = this.inspect(applied, repaired);
		}
		return { order: current, applied, closed: inspection.closed };
	}

	private inspect(applied: LayoutStructure, repaired: ReadonlySet<AdjacentRelation>): Inspection {
		let closed = false;
		for (const passage of closedPassages(applied, this.topDown)) {
			closed = true;
			if (!repaired.has(passage.relation)) return { closed, next: passage };
		}
		return { closed, next: undefined };
	}

	private moved(order: RankOrder, passage: ClosedPassage): RankOrder | undefined {
		const { componentIndex, rank } = defined(this.rowOf.get(passage.relation.lower));
		const index = this.bands.get(bandKey(componentIndex, rank, passage.container));
		if (index === undefined) return undefined;
		const band = besideWalls(defined(order[index]), passage);
		if (band === undefined) return undefined;
		const moved = [...order];
		moved[index] = band;
		return repairBlockOrder(this.domain, moved);
	}
}
