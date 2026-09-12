import { VisualGraphBuilder } from './visual-graph-builder';

/** Fresh builders for named topologies; assertions remain in each consuming scenario. */
export const graphFixtures = {
	twoSuccessors(): VisualGraphBuilder {
		return new VisualGraphBuilder({ width: 100, height: 60 })
			.nodes(['a', 'b', 'c'])
			.successorsOf('a', ['b', 'c']);
	},
	threeSuccessors(): VisualGraphBuilder {
		return graphFixtures.twoSuccessors().nodes(['d']).successorsOf('a', ['d']);
	},
};
