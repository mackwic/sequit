import type { LayoutDirection } from '../../../../lib/core/document/logic-document';
import { axesFor } from '../directions';
import { VisualGraphBuilder } from './visual-graph-builder';

/** Fresh builders for named topologies; assertions remain in each consuming scenario. */
export const graphFixtures = {
	routingNodes(
		ids: readonly string[],
		direction: LayoutDirection,
		content = 80,
	): VisualGraphBuilder {
		let size = { width: content, height: 60 };
		if (axesFor(direction).transverse === 'y') size = { width: 60, height: content };
		return new VisualGraphBuilder(size).nodes(ids);
	},
	crossingRoutes(direction: LayoutDirection, content = 80): VisualGraphBuilder {
		return graphFixtures
			.routingNodes(['a', 'b', 'c', 'd'], direction, content)
			.arrowsFrom('a', ['c', 'd'])
			.arrowsFrom('b', ['c', 'd']);
	},
	independentNodes(ids: readonly string[]): VisualGraphBuilder {
		return new VisualGraphBuilder({ width: 100, height: 60 }).nodes(ids);
	},
	directedChain(): VisualGraphBuilder {
		return graphFixtures.independentNodes(['a', 'b']).successorsOf('a', ['b']);
	},
	twoPredecessors(): VisualGraphBuilder {
		return graphFixtures
			.independentNodes(['a', 'b', 'c'])
			.successorsOf('a', ['c'])
			.successorsOf('b', ['c']);
	},
	threePredecessors(): VisualGraphBuilder {
		return graphFixtures
			.independentNodes(['a', 'b', 'c', 'd'])
			.successorsOf('a', ['d'])
			.successorsOf('b', ['d'])
			.successorsOf('c', ['d']);
	},
	sharedSuccessors(): VisualGraphBuilder {
		return graphFixtures
			.independentNodes(['a', 'b', 'c', 'd'])
			.successorsOf('a', ['c', 'd'])
			.successorsOf('b', ['c', 'd']);
	},
	twoSuccessors(): VisualGraphBuilder {
		return graphFixtures.independentNodes(['a', 'b', 'c']).successorsOf('a', ['b', 'c']);
	},
	threeSuccessors(): VisualGraphBuilder {
		return graphFixtures.twoSuccessors().nodes(['d']).successorsOf('a', ['d']);
	},
};
