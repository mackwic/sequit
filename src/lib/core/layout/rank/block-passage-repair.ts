import { defined } from '../../document/logic-document';
import {
	commonContainer,
	type GroupBlocks,
	groupBlocks,
	type RowContainers,
	rowContainers,
} from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { AdjacentRelation } from './block-passages';
import type { RankOrder } from './rank-order';
import { type RankOrderDomain, repairBlockOrder } from './rank-ordering';

/** A repaired order, and whether a wall still closes a passage there. */
export interface ReopenedOrder {
	readonly order: RankOrder;
	readonly closed: boolean;
}

/**
 * One end of a relation in the container holding both: the item standing for it, the
 * container's slots in the row, and the band ordering the movable ones. Pinned slots never
 * move, so the slots and the band tell where any item stands under any order.
 */
interface ContainerSide {
	readonly item: string;
	readonly slots: readonly string[];
	readonly band: number | undefined;
	/** Slot index of each band position. */
	readonly movable: readonly number[];
}

/**
 * An adjacent relation a wall may separate. Which blocks the container holds in both rows does
 * not depend on the order, only their sides do.
 */
interface WalledRelation {
	readonly upper: ContainerSide;
	readonly lower: ContainerSide;
	readonly walls: readonly string[];
}

interface RowLocation {
	readonly componentIndex: number;
	readonly rank: number;
	readonly row: readonly string[];
}

function bandKey(componentIndex: number, rank: number, container: string | undefined): string {
	return `${componentIndex}\u0000${rank}\u0000${container ?? ''}`;
}

/** Where an item stands among its container's slots once the order fills the movable ones. */
function slotOf(order: RankOrder, side: ContainerSide, id: string): number {
	if (side.band !== undefined) {
		const at = defined(order[side.band]).indexOf(id);
		if (at >= 0) return defined(side.movable[at]);
	}
	return side.slots.indexOf(id);
}

function wallsBefore(order: RankOrder, side: ContainerSide, walls: readonly string[]): string[] {
	const at = slotOf(order, side, side.item);
	return walls.filter((wall) => slotOf(order, side, wall) < at);
}

/**
 * A block present in two adjacent rows has one continuous frame between them: a relation whose
 * endpoints stand on different sides of it there cannot be routed, whatever the geometry.
 */
function closedBy(order: RankOrder, relation: WalledRelation): boolean {
	const above = wallsBefore(order, relation.upper, relation.walls);
	const below = wallsBefore(order, relation.lower, relation.walls);
	if (above.length !== below.length) return true;
	return above.some((wall) => !below.includes(wall));
}

/** The lower band with its item moved just past the walls it stands on the wrong side of. */
function besideWalls(order: RankOrder, relation: WalledRelation): string[] | undefined {
	const { lower, walls } = relation;
	if (lower.band === undefined) return undefined;
	const band = defined(order[lower.band]);
	const at = band.indexOf(lower.item);
	if (at < 0) return undefined;
	const before = new Set(wallsBefore(order, relation.upper, walls));
	const rest = band.filter((id) => id !== lower.item);
	let low = 0;
	let high = rest.length;
	for (const [index, id] of rest.entries()) {
		if (before.has(id)) low = Math.max(low, index + 1);
		else if (walls.includes(id)) high = Math.min(high, index);
	}
	if (low > high) return undefined;
	rest.splice(Math.min(Math.max(at, low), high), 0, lower.item);
	return rest;
}

/** Container slots of every row, grouped once, and the band of each container in each row. */
class ContainerSides {
	private readonly bands: ReadonlyMap<string, number>;
	private readonly rows = new Map<string, RowContainers>();

	constructor(
		private readonly domain: RankOrderDomain,
		private readonly blocks: GroupBlocks,
	) {
		this.bands = new Map(
			domain.locations.map((location, index) => [
				bandKey(location.componentIndex, location.rank, location.container),
				index,
			]),
		);
	}

	side(at: RowLocation, container: string | undefined, item: string): ContainerSide | undefined {
		const key = bandKey(at.componentIndex, at.rank, undefined);
		const containers = this.rows.get(key) ?? rowContainers(at.row, this.blocks);
		this.rows.set(key, containers);
		const slots = containers.slots.get(container);
		if (slots === undefined) return undefined;
		const band = this.bands.get(bandKey(at.componentIndex, at.rank, container));
		const movable: number[] = [];
		if (band !== undefined) {
			const ids = new Set(this.domain.bands[band]);
			for (const [index, id] of slots.entries()) if (ids.has(id)) movable.push(index);
		}
		return { item, slots, band, movable };
	}
}

/** The walls that may separate one relation, undefined when none can. */
function walledRelation(
	relation: AdjacentRelation,
	blocks: GroupBlocks,
	sides: ContainerSides,
	locations: ReadonlyMap<string, RowLocation>,
): WalledRelation | undefined {
	const common = commonContainer(blocks, relation.upper, relation.lower);
	const upperAt = locations.get(relation.upper);
	const lowerAt = locations.get(relation.lower);
	if (common === undefined || upperAt === undefined) return undefined;
	if (lowerAt === undefined) return undefined;
	const upper = sides.side(upperAt, common.container, common.left);
	const lower = sides.side(lowerAt, common.container, common.right);
	if (upper === undefined || lower === undefined) return undefined;
	const endpoints = new Set([common.left, common.right]);
	const walls = upper.slots.filter(
		(id) => blocks.ids.has(id) && !endpoints.has(id) && lower.slots.includes(id),
	);
	if (walls.length === 0) return undefined;
	return { upper, lower, walls };
}

/** Relations that a wall may separate, top down. */
function walledRelations(
	structure: LayoutStructure,
	domain: RankOrderDomain,
	relations: readonly AdjacentRelation[],
): readonly WalledRelation[] {
	const blocks = groupBlocks(structure.graph);
	if (blocks.ids.size === 0) return [];
	const locations = new Map<string, RowLocation>();
	for (const [componentIndex, component] of structure.components.entries())
		for (const [rank, row] of component.rows.ordinary.entries())
			for (const id of row) locations.set(id, { componentIndex, rank, row });
	const sides = new ContainerSides(domain, blocks);
	return relations
		.toSorted((left, right) => left.rank - right.rank)
		.flatMap((relation) => walledRelation(relation, blocks, sides, locations) ?? []);
}

/**
 * Rows are ordered top down, as placement orders them: a lower endpoint that a wall separates
 * from its upper neighbour moves beside that wall, on its neighbour's side. Each relation is
 * repaired once; a block moved this way keeps its sibling order in every band. Passages are read
 * on the bands directly, without applying the order to the rows.
 */
export class BlockPassageRepair {
	private readonly walled: readonly WalledRelation[];

	constructor(
		structure: LayoutStructure,
		private readonly domain: RankOrderDomain,
		relations: readonly AdjacentRelation[],
	) {
		this.walled = walledRelations(structure, domain, relations);
	}

	/** Whether a wall closes a passage in an order whose sibling blocks keep one order. */
	closes(order: RankOrder): boolean {
		return this.walled.some((relation) => closedBy(order, relation));
	}

	reopen(order: RankOrder): ReopenedOrder {
		const repaired = new Set<WalledRelation>();
		const next = (current: RankOrder): WalledRelation | undefined =>
			this.walled.find((relation) => !repaired.has(relation) && closedBy(current, relation));
		let current = order;
		for (let relation = next(current); relation !== undefined; relation = next(current)) {
			repaired.add(relation);
			const band = besideWalls(current, relation);
			if (band === undefined) continue;
			const moved = [...current];
			moved[defined(relation.lower.band)] = band;
			current = repairBlockOrder(this.domain, moved);
		}
		return { order: current, closed: this.closes(current) };
	}
}
