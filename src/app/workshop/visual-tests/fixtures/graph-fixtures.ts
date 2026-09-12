import { VisualGraphBuilder } from './visual-graph-builder';

/** Fresh builders for named topologies; assertions remain in each consuming scenario. */
export const graphFixtures = {
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
