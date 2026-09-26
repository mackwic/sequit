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
	const byEndpoint = new Map<string, number>();
	for (const componentIndex of new Set(
		domain.locations.map(({ componentIndex }) => componentIndex),
	))
		for (const id of defined(structure.components[componentIndex]).ids)
			byEndpoint.set(id, componentIndex);
	const counts = new Map<number, number>();
	for (const { relation } of graph.relations) {
		const componentIndex = byEndpoint.get(relation.from);
		if (componentIndex !== undefined)
			counts.set(componentIndex, (counts.get(componentIndex) ?? 0) + 1);
	}
	let pairwiseWork = 0;
	for (const count of counts.values()) pairwiseWork += count * count;
	const product =
		boundedRankOrderEnumerationSize(domain, MAX_COMPLETE_PIPELINES) ?? MAX_COMPLETE_PIPELINES;
	// One full-document pipeline per candidate, but changing one weak component never
	// introduces route comparisons between two unrelated weak components.
	return product * (graph.relations.length + pairwiseWork);
}

/** Keep affordable components' exchange bands; an expensive component stays documentary. */
function affordableDomain(
	graph: LogicGraph,
	structure: LayoutStructure,
	domain: RankOrderDomain,
): { readonly domain: RankOrderDomain; readonly skippedComponents: number } {
	const groups = new Map<number, number[]>();
	for (const [index, location] of domain.locations.entries()) {
		let indices = groups.get(location.componentIndex);
		if (indices === undefined) {
			indices = [];
			groups.set(location.componentIndex, indices);
		}
		indices.push(index);
	}
	const selected: number[] = [];
	let skippedComponents = 0;
	for (const indices of groups.values()) {
		const proposed = [...selected, ...indices];
		const candidate: RankOrderDomain = {
			bands: proposed.map((index) => defined(domain.bands[index])),
			locations: proposed.map((index) => defined(domain.locations[index])),
		};
		if (estimatedRouteWork(graph, structure, candidate) > MAX_ESTIMATED_ROUTE_WORK) {
			skippedComponents += 1;
			continue;
		}
		selected.push(...indices);
	}
	return {
		domain: {
			bands: selected.map((index) => defined(domain.bands[index])),
			locations: selected.map((index) => defined(domain.locations[index])),
		},
		skippedComponents,
	};
}

export function selectDedicatedRankLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	services: {
		readonly options: LayoutOptions;
		readonly evaluate: typeof evaluateDedicatedLayout;
		readonly admit?: ((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
	},
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	const { options, evaluate } = services;
	const structure = prepareLayout(graph, ranks);
	const completeDomain = collectRankOrderDomain(structure);
	const noBand = completeDomain.bands.length === 0;
	let domain = completeDomain;
	let skippedComponents = 0;
	if (!noBand && estimatedRouteWork(graph, structure, completeDomain) > MAX_ESTIMATED_ROUTE_WORK) {
		const affordable = affordableDomain(graph, structure, completeDomain);
		domain = affordable.domain;
		skippedComponents = affordable.skippedComponents;
	}
	if (domain.bands.length === 0) {
		const layout = evaluate(structure, measurements, options);
		let stop = RankSearchStop.NoBand;
		if (!noBand) stop = RankSearchStop.ShapeEnvelope;
		return {
			layout,
			witness: {
				mode: RankSearchMode.Skipped,
				stop,
				proposed: 1,
				evaluated: 1,
				valid: 0,
				rejected: [],
				unverified: 1,
				...(skippedComponents > 0 && { skippedComponents }),
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
		admit: services.admit,
	});
	const layout = (search.selected?.evaluation ?? baseline).complete();
	if (skippedComponents === 0) return { layout, witness: search.witness };
	return {
		layout,
		witness: { ...search.witness, skippedComponents, exhaustive: false },
	};
}
