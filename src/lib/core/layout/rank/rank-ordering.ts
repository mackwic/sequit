import { defined, EndpointKind } from '../../document/logic-document';
import {
	expandSlots,
	type GroupBlocks,
	groupBlocks,
	type RowContainers,
	rowContainers,
} from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { RankDomain, RankOrder } from './rank-order';
import { validateRankOrder } from './rank-order';

interface RankOrderLocation {
	readonly componentIndex: number;
	readonly rank: number;
	/** Block whose direct slots the band orders; undefined for the component root. */
	readonly container?: string | undefined;
}

export interface RankOrderDomain extends RankDomain {
	readonly locations: readonly RankOrderLocation[];
	/** Blocks among the slots: their order in one container must agree across ranks. */
	readonly blockIds: ReadonlySet<string>;
}

function movable(structure: LayoutStructure, blocks: GroupBlocks, id: string): boolean {
	if (blocks.ids.has(id)) return true;
	return structure.graph.endpointsById.get(id)?.entity.kind === EndpointKind.Node;
}

function rowBands(
	structure: LayoutStructure,
	blocks: GroupBlocks,
	row: readonly string[],
): readonly (readonly [string | undefined, string[]])[] {
	const bands: (readonly [string | undefined, string[]])[] = [];
	if (row.length < 2) return bands;
	for (const [container, slots] of rowContainers(row, blocks).slots) {
		const band = slots.filter((id) => movable(structure, blocks, id));
		if (band.length >= 2) bands.push([container, band]);
	}
	return bands;
}

/**
 * Collect every container band with a real choice: the direct nodes and blocks of the root or of
 * one block in one row. Other endpoints, singleton and empty bands stay fixed.
 */
export function collectRankOrderDomain(structure: LayoutStructure): RankOrderDomain {
	const blocks = groupBlocks(structure.graph);
	const bands: string[][] = [];
	const locations: RankOrderLocation[] = [];
	for (const [componentIndex, component] of structure.components.entries())
		for (const [rank, row] of component.rows.ordinary.entries())
			for (const [container, band] of rowBands(structure, blocks, row)) {
				bands.push(band);
				locations.push({ componentIndex, rank, container });
			}
	return { bands, locations, blockIds: blocks.ids };
}

function locationKey(location: RankOrderLocation): string {
	return `${location.componentIndex}\u0000${location.container ?? ''}`;
}

/** Commit block orders rank after rank; blocks first met later join after their predecessor. */
function commitBlocks(sequence: string[], blocks: readonly string[]): void {
	let cursor = 0;
	for (const block of blocks) {
		const at = sequence.indexOf(block);
		if (at >= 0) {
			cursor = Math.max(cursor, at + 1);
			continue;
		}
		sequence.splice(cursor, 0, block);
		cursor += 1;
	}
}

/**
 * A block is rigid across its rows: in one container, sibling blocks keep one order in every
 * band. The first band where two blocks meet decides their order; later bands follow it.
 */
export function repairBlockOrder(domain: RankOrderDomain, order: RankOrder): RankOrder {
	if (domain.blockIds.size === 0) return order;
	const sequences = new Map<string, string[]>();
	let repaired: (readonly string[])[] | undefined;
	for (const [index, location] of domain.locations.entries()) {
		const band = defined(order[index]);
		const bandBlocks = band.filter((id) => domain.blockIds.has(id));
		if (bandBlocks.length === 0) continue;
		const key = locationKey(location);
		const sequence = sequences.get(key) ?? [];
		sequences.set(key, sequence);
		commitBlocks(sequence, bandBlocks);
		const sorted = bandBlocks.toSorted(
			(left, right) => sequence.indexOf(left) - sequence.indexOf(right),
		);
		if (sorted.every((id, position) => id === bandBlocks[position])) continue;
		repaired ??= [...order];
		const next = sorted.values();
		repaired[index] = band.map((id) => {
			if (!domain.blockIds.has(id)) return id;
			return defined(next.next().value);
		});
	}
	return repaired ?? order;
}

/** A row with the movable slots of some containers replaced by their bands, in band order. */
export function reorderedRow(
	structure: LayoutStructure,
	row: readonly string[],
	bands: ReadonlyMap<string | undefined, readonly string[]>,
): readonly string[] {
	const blocks = groupBlocks(structure.graph);
	const { top, slots } = rowContainers(row, blocks);
	for (const [container, band] of bands) {
		const next = band.values();
		slots.set(
			container,
			defined(slots.get(container)).map((id) => {
				if (!movable(structure, blocks, id)) return id;
				return defined(next.next().value);
			}),
		);
	}
	return expandSlots(slots, top);
}

/** Apply a validated slot permutation, block orders repaired, retaining every pinned slot. */
export function applyRankOrder(
	structure: LayoutStructure,
	domain: RankOrderDomain,
	order: RankOrder,
): LayoutStructure {
	if (!validateRankOrder(domain, order)) throw new Error('Invalid ordinary-node rank order');
	const repaired = repairBlockOrder(domain, order);
	const blocks = groupBlocks(structure.graph);
	const changed = new Map<number, Map<number, Map<string | undefined, readonly string[]>>>();
	// Several bands share a row, one per container: group the row once.
	const rowsByRow = new Map<readonly string[], RowContainers>();
	for (const [bandIndex, location] of domain.locations.entries()) {
		const band = defined(repaired[bandIndex]);
		const component = defined(structure.components[location.componentIndex]);
		const row = defined(component.rows.ordinary[location.rank]);
		let containers = rowsByRow.get(row);
		if (containers === undefined) {
			containers = rowContainers(row, blocks);
			rowsByRow.set(row, containers);
		}
		const current = containers.slots
			.get(location.container)
			?.filter((id) => movable(structure, blocks, id));
		if (band.every((id, index) => id === current?.[index])) continue;
		const rows =
			changed.get(location.componentIndex) ??
			new Map<number, Map<string | undefined, readonly string[]>>();
		changed.set(location.componentIndex, rows);
		const bands = rows.get(location.rank) ?? new Map<string | undefined, readonly string[]>();
		rows.set(location.rank, bands);
		bands.set(location.container, band);
	}
	if (changed.size === 0) return structure;
	const components = structure.components.map((component, componentIndex) => {
		const changedRows = changed.get(componentIndex);
		if (changedRows === undefined) return component;
		const ordinary = [...component.rows.ordinary];
		for (const [rank, bands] of changedRows)
			ordinary[rank] = reorderedRow(structure, defined(ordinary[rank]), bands);
		return { ...component, rows: { ...component.rows, ordinary } };
	});
	return { ...structure, components };
}
