import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { evaluateDedicatedLayout } from './layout-engine';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import { boundedRankOrderEnumerationSize } from './rank-order';
import {
	type RankOrderSearchWitness,
	RankSearchMode,
	RankSearchStop,
	searchDedicatedRankOrders,
} from './rank-order-search';
import { applyRankOrder, collectRankOrderDomain, type RankOrderDomain } from './rank-ordering';
import { type LayoutStructure, prepareLayout } from './structure/prepare-layout';

const MAX_ESTIMATED_ROUTE_WORK = 4096;
const MAX_COMPLETE_PIPELINES = 12;

/** A bounded approximation of routing/validation work, not a global endpoint-count cutoff. */
function estimatedRouteWork(
	graph: LogicGraph,
	structure: LayoutStructure,
	domain: RankOrderDomain,
): number {
	const totalRelations = graph.relations.length;
	if (domain.bands.length === 0) return totalRelations * totalRelations;
	const selected = new Set(
		domain.locations.flatMap(
			({ componentIndex }) => defined(structure.components[componentIndex]).ids,
		),
	);
	let relevantRelations = 0;
	for (const { relation } of graph.relations)
		if (selected.has(relation.from) || selected.has(relation.to)) relevantRelations += 1;
	const product =
		boundedRankOrderEnumerationSize(domain, MAX_COMPLETE_PIPELINES) ?? MAX_COMPLETE_PIPELINES;
	// Each candidate routes every edge; only edges in permutable components influence alternatives.
	// The total edge count still bounds global port planning and route-contact validation.
	return product * totalRelations * (1 + relevantRelations);
}

export function selectDedicatedRankLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	services: { readonly options: LayoutOptions; readonly evaluate: typeof evaluateDedicatedLayout },
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	const { options, evaluate } = services;
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	if (estimatedRouteWork(graph, structure, domain) > MAX_ESTIMATED_ROUTE_WORK) {
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
				exhaustive: false,
				truncated: false,
			},
		};
	}
	const baseline = evaluate(structure, measurements, options, true);
	const search = searchDedicatedRankOrders({
		structure,
		domain,
		measurements,
		baseline,
		evaluate: (order) =>
			evaluate(applyRankOrder(structure, domain, order), measurements, options, true),
		limits: { completePipelines: MAX_COMPLETE_PIPELINES, uniqueProposals: 48 },
	});
	return { layout: (search.selected?.evaluation ?? baseline).complete(), witness: search.witness };
}
