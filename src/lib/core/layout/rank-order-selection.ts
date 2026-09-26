import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { evaluateDedicatedLayout } from './layout-engine';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import {
	type RankOrderSearchWitness,
	RankSearchMode,
	RankSearchStop,
	searchDedicatedRankOrders,
} from './rank-order-search';
import { applyRankOrder, collectRankOrderDomain } from './rank-ordering';
import { prepareLayout } from './structure/prepare-layout';

export function selectDedicatedRankLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	services: { readonly options: LayoutOptions; readonly evaluate: typeof evaluateDedicatedLayout },
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	const { options, evaluate } = services;
	const structure = prepareLayout(graph, ranks);
	if (graph.endpointsById.size > 8 || graph.relations.length > 12) {
		const layout = evaluate(structure, measurements, options);
		return {
			layout,
			witness: {
				mode: RankSearchMode.Skipped,
				stop: RankSearchStop.ShapeEnvelope,
				proposed: 1,
				evaluated: 1,
				valid: 0,
				rejected: [],
				unverified: 1,
				prunedByLowerBound: 0,
				work: { completePipelines: 1, validations: 0, routeRunsInspected: 0 },
				exhaustive: true,
				truncated: false,
			},
		};
	}
	const domain = collectRankOrderDomain(structure);
	const baseline = evaluate(structure, measurements, options, true);
	const search = searchDedicatedRankOrders({
		structure,
		domain,
		measurements,
		baseline,
		evaluate: (order) =>
			evaluate(applyRankOrder(structure, domain, order), measurements, options, true),
		limits: { completePipelines: 12, uniqueProposals: 48 },
	});
	return { layout: (search.selected?.evaluation ?? baseline).complete(), witness: search.witness };
}
