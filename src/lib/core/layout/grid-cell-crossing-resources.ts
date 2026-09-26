import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import { type GridRoutingEdges, gridRoutingEdges } from './grid-cell-crossing';
import type { GridCellInput } from './grid-cell-types';

export interface GridCrossingResources {
	readonly edges: GridRoutingEdges;
	readonly gutterIds: readonly (readonly string[])[];
}

/** Crossings owned by this grid charge only the columns of their endpoints, never intervening
 * columns. Compute this before placement so that frame and route allocation share the resources. */
export function gridCrossingResources(
	input: GridCellInput,
	crossing: readonly LogicRelation[],
): GridCrossingResources {
	const columnByCellId = new Map(input.cells.map(({ id, column }) => [id, column]));
	const gutterIds = Array.from({ length: input.minimumColumnWidths.length }, () => [] as string[]);
	for (const { id, from, to } of crossing) {
		const source = defined(columnByCellId.get(defined(input.cellByEndpointId.get(from))));
		const target = defined(columnByCellId.get(defined(input.cellByEndpointId.get(to))));
		defined(gutterIds[source]).push(id);
		if (source !== target) defined(gutterIds[target]).push(id);
	}
	for (const ids of gutterIds) ids.sort(compareCanonicalStrings);
	return { edges: gridRoutingEdges(input.rootId, gutterIds, crossing.length), gutterIds };
}
