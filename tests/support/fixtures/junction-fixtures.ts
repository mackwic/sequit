import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualGraphBuilder } from '../builders/visual-graph-builder';
import { axesFor } from '../harnesses/visual-directions';
import { graphFixtures } from './graph-fixtures';
import { railPolicy } from './routing-fixtures';

/** Compact junction calibration, asserted independently of engine configuration. */
export const junctionClearance = railPolicy.inset;

/** Explicit topologies; no expected ranks, positions, collection or routing is computed here. */
export const junctionFixtures = {
	chain(
		direction: LayoutDirection,
		ids: readonly string[] = ['j'],
		primary?: number,
	): VisualGraphBuilder {
		let size = { width: 28, height: 20 };
		if (primary !== undefined) {
			if (axesFor(direction).primary === 'x') size = { ...size, width: primary };
			else size = { ...size, height: primary };
		}
		const graph = graphFixtures.routingNodes(['a', 'b'], direction).junctions(ids, size);
		let previous = 'a';
		for (const id of [...ids, 'b']) {
			graph.successorsOf(previous, [id]);
			previous = id;
		}
		return graph;
	},
	incomingBranches(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures.chain(direction).nodes(['c']).successorsOf('j', ['c']);
	},
	outgoingBranches(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures.chain(direction).nodes(['c']).successorsOf('c', ['j']);
	},
	parallel(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures
			.chain(direction, ['j1'])
			.nodes(['c'])
			.junctions(['j2'])
			.successorsOf('a', ['j2'])
			.successorsOf('j2', ['c']);
	},
	mixed(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures.chain(direction).nodes(['c']).successorsOf('a', ['c']);
	},
	differentDepths(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures
			.incomingBranches(direction)
			.nodes(['d'])
			.successorsOf('b', ['c'])
			.successorsOf('c', ['d'])
			.successorsOf('j', ['d']);
	},
	recursiveDepths(direction: LayoutDirection): VisualGraphBuilder {
		return junctionFixtures
			.chain(direction, ['j1', 'j2'])
			.nodes(['c', 'd'])
			.successorsOf('b', ['c'])
			.successorsOf('c', ['d'])
			.successorsOf('j1', ['d']);
	},
	crossing(direction: LayoutDirection): VisualGraphBuilder {
		return graphFixtures
			.routingNodes(['a', 'b', 'c', 'd', 'e'], direction)
			.junctions(['j1', 'j2'])
			.successorsOf('a', ['j1', 'j2'])
			.successorsOf('b', ['j1', 'j2'])
			.successorsOf('j1', ['c', 'd', 'e'])
			.successorsOf('j2', ['c', 'd', 'e']);
	},
};
