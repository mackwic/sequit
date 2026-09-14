import { VisualGraphBuilder, type VisualGraphData } from '../builders/visual-graph-builder';

/** An ordinary crossing reallocates rails beside a previously clear junction chain. */
export function junctionCrossingObstacle(): VisualGraphData {
	return new VisualGraphBuilder({ width: 80, height: 60 })
		.nodes(['r', 'p0', 's', 'p1', 'p2', 'u0', 'g', 'u1', 'u2'])
		.junctions(['j1', 'j2'], { width: 28, height: 20 })
		.arrowsFrom('s', ['r'])
		.arrowsFrom('j1', ['s'])
		.arrowsFrom('j2', ['j1'])
		.arrowsFrom('g', ['j2'])
		.arrowsFrom('p0', ['r'])
		.arrowsFrom('u0', ['p1'])
		.arrowsFrom('p1', ['r'])
		.arrowsFrom('u1', ['p2'])
		.arrowsFrom('p2', ['r'])
		.arrowsFrom('u2', ['p2', 'p0'])
		.build();
}
