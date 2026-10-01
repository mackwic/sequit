import { defined } from '../../document/logic-document';
import type { JunctionPlacement } from '../structure/junction-structure';
import type { LayoutStructure } from '../structure/prepare-layout';

/** Ordinary then junction ids of every component row, components one after the other. */
export function topologyRows(structure: LayoutStructure): string[][] {
	const rows: string[][] = [];
	for (const component of structure.components)
		for (const [rank, ordinary] of component.rows.ordinary.entries())
			rows.push([...ordinary, ...defined(component.rows.junction[rank])]);
	return rows;
}

/**
 * Placement centers a junction on its children and their family on the junction's parents: in
 * its own row, the rail stands under those parents. Without one there, it takes its children's
 * mean position.
 */
function junctionAnchors(
	structure: LayoutStructure,
	id: string,
	junction: JunctionPlacement,
	rowOf: ReadonlyMap<string, number>,
): readonly string[] {
	const row = rowOf.get(id);
	const parents = defined(structure.graph.outgoingByEndpointId.get(id)).filter(
		(parent) => !structure.junctionIds.has(parent) && rowOf.get(parent) === row,
	);
	if (parents.length > 0) return parents;
	return junction.neighbors.filter((child) => rowOf.has(child));
}

/**
 * The one coordinate system shared by the topology oracle and the barycentric sweep: an item's
 * ordinal in its row, ordinary items then junction rails, normalized by the row's length.
 */
export function rowPosition(ordinal: number, rowLength: number): number {
	return (ordinal + 1) / (rowLength + 1);
}

/**
 * Normalized transverse positions by row ordinal. A junction takes the mean of its anchors;
 * the topology oracle keeps it after ordinary anchors when that mean coincides with one.
 */
export function transversePositions(
	structure: LayoutStructure,
	rows: readonly (readonly string[])[],
): ReadonlyMap<string, number> {
	const positions = new Map<string, number>();
	const rowOf = new Map<string, number>();
	for (const [index, row] of rows.entries())
		for (const [ordinal, id] of row.entries()) {
			positions.set(id, rowPosition(ordinal, row.length));
			rowOf.set(id, index);
		}
	for (const [id, junction] of structure.junctions) {
		if (!rowOf.has(id)) continue;
		const anchors = junctionAnchors(structure, id, junction, rowOf);
		if (anchors.length === 0) continue;
		const sum = anchors.reduce((total, anchor) => total + defined(positions.get(anchor)), 0);
		positions.set(id, sum / anchors.length);
	}
	return positions;
}
