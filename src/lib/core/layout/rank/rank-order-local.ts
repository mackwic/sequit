import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	type DedicatedCandidateFailure,
	type DedicatedLayoutEvaluation,
	isDedicatedCandidateFailure,
	type LayoutMeasurements,
} from '../layout-types';
import { type LayoutStructure, prepareLayout } from '../structure/prepare-layout';
import type { RankOrder } from './rank-order';
import {
	type RankSearchComponent,
	rankSearchComponents,
	visitRelationComponents,
} from './rank-order-components';
import { type DedicatedLayoutEvaluator, searchDedicatedRankOrders } from './rank-order-search';
import type { RankOrderSearchWitness } from './rank-order-witness';
import { applyRankOrder, collectRankOrderDomain, type RankOrderDomain } from './rank-ordering';

/** Shape-only eligibility weight; not a bound on route segments or validation work. */
const MAX_ELIGIBILITY_WEIGHT = 4096;
export const MAX_COMPLETE_PIPELINES = 12;
export const MAX_UNIQUE_PROPOSALS = 48;

type ComponentEvidence = NonNullable<RankOrderSearchWitness['components']>[number];

export interface SearchBudgets {
	readonly bands: ReadonlyMap<number, readonly number[]>;
	readonly byEndpoint: ReadonlyMap<string, number>;
	readonly limits: ReadonlyMap<number, number>;
	readonly skippedComponents: number;
}

export interface LocalChoice {
	readonly orders: string[][];
	readonly changed: Set<number>;
	readonly evidence: ComponentEvidence[];
	readonly skippedComponents: number;
	/** One search covered the whole document: its validations are global ones. */
	readonly wholeDocument: boolean;
	/** That search validated the documentary layout and kept it. */
	readonly provenBaseline: boolean;
}

interface LocalSearchInput {
	readonly graph: LogicGraph;
	readonly structure: LayoutStructure;
	readonly measurements: LayoutMeasurements;
	readonly baseline: DedicatedLayoutEvaluation;
	readonly domain: RankOrderDomain;
	readonly budgets: SearchBudgets;
	readonly evaluate: DedicatedLayoutEvaluator;
}

interface ComponentSearchInput {
	readonly component: RankSearchComponent;
	readonly global: RankOrderDomain;
	readonly globalStructure: LayoutStructure;
	readonly sharedBaseline: DedicatedLayoutEvaluation;
	readonly indices: readonly number[];
	readonly limit: number;
	readonly evaluate: DedicatedLayoutEvaluator;
}

interface ComponentSearchResult {
	readonly evidence: ComponentEvidence;
	readonly matched: readonly number[];
	readonly selected: RankOrder;
	readonly provenBaseline: boolean;
}

/** Bound shape-only projected dependency pairs, not measured route or validation work. */
function localPipelineLimit(relationCount: number): number {
	const eligibilityWeight = relationCount * (relationCount + 1);
	return Math.min(MAX_COMPLETE_PIPELINES, Math.floor(MAX_ELIGIBILITY_WEIGHT / eligibilityWeight));
}

function componentBands(domain: RankOrderDomain): ReadonlyMap<number, readonly number[]> {
	const byComponent = new Map<number, number[]>();
	for (const [index, location] of domain.locations.entries()) {
		const indices = byComponent.get(location.componentIndex) ?? [];
		indices.push(index);
		byComponent.set(location.componentIndex, indices);
	}
	return byComponent;
}

/**
 * Count each relation once per local document holding it, with its projected member pairs. A
 * count only grows, so counting stops once every component exceeds the search budget.
 */
export function searchBudgets(
	graph: LogicGraph,
	structure: LayoutStructure,
	domain: RankOrderDomain,
): SearchBudgets {
	const bands = componentBands(domain);
	const byEndpoint = new Map<string, number>();
	const limits = new Map<number, number>();
	if (bands.size === 0) return { bands, byEndpoint, limits, skippedComponents: 0 };
	for (const [index, component] of structure.components.entries())
		for (const id of component.ids) byEndpoint.set(id, index);
	const counts = new Map<number, number>();
	for (const index of bands.keys()) counts.set(index, 0);
	let searchable = bands.size;
	visitRelationComponents(graph, byEndpoint, (relationIndex, holder) => {
		const count = counts.get(holder);
		if (count === undefined || localPipelineLimit(count) < 2) return true;
		const effective = defined(graph.effectiveRelations[relationIndex]);
		const next = count + effective.sourceIds.length * effective.targetIds.length;
		counts.set(holder, next);
		if (localPipelineLimit(next) < 2) searchable -= 1;
		return searchable > 0;
	});
	let skippedComponents = 0;
	for (const index of bands.keys()) {
		const limit = localPipelineLimit(defined(counts.get(index)));
		if (limit >= 2) limits.set(index, limit);
		else skippedComponents += 1;
	}
	return { bands, byEndpoint, limits, skippedComponents };
}

/** Compare the local and full-document rows by rank and members, not component index. */
function matchingBands(
	global: RankOrderDomain,
	indices: readonly number[],
	local: RankOrderDomain,
): readonly number[] {
	const matched: number[] = [];
	for (const [index, location] of local.locations.entries()) {
		const ids = defined(local.bands[index]);
		const candidate = indices.find((globalIndex) => {
			const globalLocation = defined(global.locations[globalIndex]);
			if (globalLocation.rank !== location.rank) return false;
			if (globalLocation.container !== location.container) return false;
			const original = defined(global.bands[globalIndex]);
			return original.length === ids.length && ids.every((id) => original.includes(id));
		});
		matched.push(defined(candidate));
	}
	return matched;
}

function searchComponent(input: ComponentSearchInput): ComponentSearchResult {
	const { component, global, globalStructure, sharedBaseline, indices, limit, evaluate } = input;
	let structure = globalStructure;
	let baseline: DedicatedLayoutEvaluation | DedicatedCandidateFailure = sharedBaseline;
	if (component.graph !== globalStructure.graph) {
		structure = prepareLayout(component.graph, component.ranks);
		try {
			baseline = evaluate(structure, component.measurements, {}, true);
		} catch (error) {
			if (!isDedicatedCandidateFailure(error)) throw error;
			baseline = error;
		}
	}
	const domain = collectRankOrderDomain(structure);
	const matched = matchingBands(global, indices, domain);
	const search = searchDedicatedRankOrders({
		structure,
		domain,
		measurements: component.measurements,
		baseline,
		evaluate: (order) =>
			evaluate(applyRankOrder(structure, domain, order), component.measurements, {}, true),
		limits: { completePipelines: limit, uniqueProposals: MAX_UNIQUE_PROPOSALS },
	});
	const selected = search.selected?.order ?? domain.bands;
	let provenBaseline = false;
	if (component.graph === globalStructure.graph)
		provenBaseline = search.selected?.evaluation === sharedBaseline;
	return {
		evidence: {
			ids: component.ids,
			witness: search.witness,
			pipelineLimit: limit,
			selected,
		},
		matched,
		selected,
		provenBaseline,
	};
}

function recordSelectedBands(
	global: RankOrderDomain,
	searched: ComponentSearchResult,
	orders: string[][],
): boolean {
	let changed = false;
	for (const [index, globalIndex] of searched.matched.entries()) {
		const selected = defined(searched.selected[index]);
		const original = defined(global.bands[globalIndex]);
		if (selected.every((id, position) => id === original[position])) continue;
		orders[globalIndex] = [...selected];
		changed = true;
	}
	return changed;
}

/** Local scores propose orders only; the completed document may share gaps and rails. */
export function chooseLocal(input: LocalSearchInput): LocalChoice {
	const { graph, structure, measurements, baseline, domain, budgets, evaluate } = input;
	const orders = domain.bands.map((band) => [...band]);
	const changed = new Set<number>();
	const evidence: ComponentEvidence[] = [];
	if (budgets.limits.size === 0)
		return {
			orders,
			changed,
			evidence,
			skippedComponents: budgets.skippedComponents,
			wholeDocument: false,
			provenBaseline: false,
		};
	let components: readonly RankSearchComponent[];
	if (structure.components.length === 1 && budgets.limits.has(0)) {
		components = [
			{
				index: 0,
				ids: defined(structure.components[0]).ids,
				graph,
				ranks: structure.ranks,
				measurements,
				relationCount: graph.relations.length,
			},
		];
	} else {
		components = rankSearchComponents(
			graph,
			structure,
			measurements,
			new Set(budgets.limits.keys()),
		);
	}
	let provenBaseline = false;
	for (const component of components) {
		const searched = searchComponent({
			component,
			global: domain,
			globalStructure: structure,
			sharedBaseline: baseline,
			indices: defined(budgets.bands.get(component.index)),
			limit: defined(budgets.limits.get(component.index)),
			evaluate,
		});
		evidence.push(searched.evidence);
		if (recordSelectedBands(domain, searched, orders)) changed.add(component.index);
		provenBaseline ||= searched.provenBaseline;
	}
	return {
		orders,
		changed,
		evidence,
		skippedComponents: budgets.skippedComponents,
		wholeDocument: components.length === 1 && components[0]?.graph === graph,
		provenBaseline,
	};
}
