import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualGraphData } from '../builders/visual-graph-builder';
import { axesFor } from '../harnesses/visual-directions';
import { graphFixtures } from './graph-fixtures';

/** A mixed child row beneath a homogeneous three-way fork, in documentary order. */
export function mixedBranchAlignment(
	direction: LayoutDirection,
	content = 220,
	narrow = 160,
): VisualGraphData {
	let narrowSize = { width: narrow, height: 60 };
	if (axesFor(direction).transverse === 'y') narrowSize = { width: 60, height: narrow };
	return graphFixtures
		.routingNodes(['r', 'p', 'q', 's', 'u', 'v', 'w'], direction, content)
		.nodes(['g'], narrowSize)
		.nodes(['x'])
		.arrowsFrom('p', ['r'])
		.arrowsFrom('q', ['r'])
		.arrowsFrom('s', ['r'])
		.arrowsFrom('u', ['p'])
		.arrowsFrom('v', ['p'])
		.arrowsFrom('w', ['q'])
		.arrowsFrom('g', ['s'])
		.arrowsFrom('x', ['s'])
		.build();
}
