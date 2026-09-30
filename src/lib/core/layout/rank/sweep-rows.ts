import { defined } from '../../document/logic-document';
import { groupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { RankOrder } from './rank-order';
import {
	applyRankOrder,
	type RankOrderDomain,
	reorderedRow,
	repairBlockOrder,
} from './rank-ordering';
import { rowPosition } from './transverse-positions';

interface StoredRow {
	items: readonly string[];
	readonly rank: number;
	/** Junctions share the row in the oracle's coordinates: they widen its scale. */
	readonly junctions: number;
}

function rowKey(componentIndex: number, rank: number): string {
	return `${componentIndex}\u0000${rank}`;
}

function sameBand(left: readonly string[] | undefined, right: readonly string[]): boolean {
	return left?.length === right.length && right.every((id, index) => id === left[index]);
}

/**
 * The flat rows of an applied order in the topology oracle's coordinates, kept up to date band
 * by band: members stand inline, a block at the mean position of its descendants in each row.
 * Changing a band measures its row again, and no other row.
 */
export class SweepRows {
	/** Normalized position of every ordinary endpoint in its row. */
	readonly positions = new Map<string, number>();
	/** Component rank of every ordinary endpoint. */
	readonly ranks = new Map<string, number>();
	private readonly blockPositions = new Map<string, Map<number, number>>();
	private readonly rows = new Map<string, StoredRow>();
	private applied: RankOrder;

	constructor(
		private readonly structure: LayoutStructure,
		private readonly domain: RankOrderDomain,
		order: RankOrder,
	) {
		const applied = applyRankOrder(structure, domain, order);
		// The caller replaces bands of its order in place: keep our own list of them.
		this.applied = [...repairBlockOrder(domain, order)];
		for (const [componentIndex, component] of applied.components.entries())
			for (const [rank, items] of component.rows.ordinary.entries()) {
				const junctions = defined(component.rows.junction[rank]).length;
				const row = { items, rank, junctions };
				this.rows.set(rowKey(componentIndex, rank), row);
				this.measure(row);
			}
	}

	/** Where a block stands in one of its rows; undefined in a row it does not reach. */
	blockPosition(block: string, rank: number): number | undefined {
		return this.blockPositions.get(block)?.get(rank);
	}

	/** Apply an order whose bands may have changed; sibling blocks keep one order, as applied. */
	update(order: RankOrder): void {
		const repaired = repairBlockOrder(this.domain, order);
		for (const [index, location] of this.domain.locations.entries()) {
			const band = defined(repaired[index]);
			if (sameBand(this.applied[index], band)) continue;
			const row = defined(this.rows.get(rowKey(location.componentIndex, location.rank)));
			row.items = reorderedRow(this.structure, row.items, new Map([[location.container, band]]));
			this.measure(row);
		}
		this.applied = [...repaired];
	}

	private measure(row: StoredRow): void {
		const { parentOf } = groupBlocks(this.structure.graph);
		const length = row.items.length + row.junctions;
		const totals = new Map<string, { sum: number; count: number }>();
		for (const [ordinal, id] of row.items.entries()) {
			const position = rowPosition(ordinal, length);
			this.positions.set(id, position);
			this.ranks.set(id, row.rank);
			for (let block = parentOf(id); block !== undefined; block = parentOf(block)) {
				const total = totals.get(block) ?? { sum: 0, count: 0 };
				totals.set(block, total);
				total.sum += position;
				total.count += 1;
			}
		}
		for (const [block, { sum, count }] of totals) {
			const byRank = this.blockPositions.get(block) ?? new Map<number, number>();
			this.blockPositions.set(block, byRank);
			byRank.set(row.rank, sum / count);
		}
	}
}
