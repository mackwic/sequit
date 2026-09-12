import { defined } from '../../document/logic-document';
import { transverseEnvelope } from '../geometry/envelope';
import { mainSize, type MutableBounds, transverseSize } from '../geometry/layout-frame';
import { ITEM_GAP, JUNCTION_CLEARANCE } from '../layout-settings';
import type { Size } from '../layout-types';
import type { JunctionPlacement } from '../structure/junction-structure';

export interface JunctionRail {
	readonly ids: readonly string[];
	readonly thickness: number;
	readonly width: number;
}

export function junctionRails(input: {
	readonly row: readonly string[];
	readonly sizes: ReadonlyMap<string, Size>;
	readonly vertical: boolean;
	readonly junctions: ReadonlyMap<string, JunctionPlacement> | undefined;
}): readonly JunctionRail[] {
	const layers: { ids: string[]; thickness: number; width: number }[] = [];
	for (const id of input.row) {
		const size = input.sizes.get(id);
		if (size === undefined) throw new Error(`Missing measured size: ${id}`);
		const depth = input.junctions?.get(id)?.depth ?? 0;
		const layer = layers[depth] ?? { ids: [], thickness: 0, width: -ITEM_GAP };
		layer.ids.push(id);
		layer.thickness = Math.max(layer.thickness, mainSize(size, input.vertical));
		layer.width += transverseSize(size, input.vertical) + ITEM_GAP;
		layers[depth] = layer;
	}
	return layers;
}

export function railSpan(rails: readonly JunctionRail[], gaps?: readonly number[]): number {
	if (rails.length === 0) return 0;
	let clearance = (rails.length + 1) * JUNCTION_CLEARANCE;
	if (gaps !== undefined) clearance = gaps.reduce((sum, gap) => sum + gap, 0);
	return rails.reduce((sum, rail) => sum + rail.thickness, 0) + clearance;
}

/** Preserve documentary order, center symmetric collisions, and align independent branches. */
export function junctionCrossPositions(input: {
	readonly rail: JunctionRail;
	readonly bounds: ReadonlyMap<string, MutableBounds>;
	readonly junctions: ReadonlyMap<string, JunctionPlacement> | undefined;
	readonly vertical: boolean;
	readonly crossLength: number;
	readonly sizes: ReadonlyMap<string, Size>;
}): ReadonlyMap<string, number> {
	const positions = new Map<string, number>();
	let cursor = Number.NEGATIVE_INFINITY;
	let correction = 0;
	for (const id of input.rail.ids) {
		const width = transverseSize(defined(input.sizes.get(id)), input.vertical);
		const neighbors = input.junctions?.get(id)?.neighbors ?? [];
		let center = input.crossLength / 2;
		if (neighbors.length > 0) {
			const envelope = transverseEnvelope(neighbors, input.bounds, input.vertical);
			center = (envelope.start + envelope.end) / 2;
		}
		const desired = center - width / 2;
		const position = Math.max(cursor, desired);
		positions.set(id, position);
		correction += desired - position;
		cursor = position + width + ITEM_GAP;
	}
	if (correction !== 0)
		for (const [id, position] of positions)
			positions.set(id, position + correction / positions.size);
	return positions;
}
