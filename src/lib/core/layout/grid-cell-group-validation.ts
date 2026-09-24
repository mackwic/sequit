import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import { within } from './grid-cell-geometry-primitives';
import type { GridCellSelected } from './grid-cell-types';

/** Checks group membership independently of local and cross-cell routing. */
export function validateGridCellGroupContainment(
	candidate: GridCellSelected,
	graph: LogicGraph,
): string | undefined {
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	for (const endpoint of [...graph.document.groups, ...graph.document.nodes]) {
		if (endpoint.groupId === undefined) continue;
		const member = defined(elements.get(endpoint.id));
		const group = defined(elements.get(endpoint.groupId));
		if (!within(group.bounds, member.bounds))
			return `Endpoint ${endpoint.id} leaves its parent group ${endpoint.groupId}.`;
	}
	return undefined;
}
