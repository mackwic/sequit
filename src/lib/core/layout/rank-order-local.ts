import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { evaluateDedicatedLayout } from './layout-engine';
import type { LayoutMeasurements } from './layout-types';
import type { RankOrder } from './rank-order';
import { type RankSearchComponent, rankSearchComponents } from './rank-order-components';
import { type RankOrderSearchWitness, searchDedicatedRankOrders } from './rank-order-search';
import { applyRankOrder, collectRankOrderDomain, type RankOrderDomain } from './rank-ordering';
import { type LayoutStructure, prepareLayout } from './structure/prepare-layout';

const MAX_ESTIMATED_ROUTE_WORK = 4096;
const MAX_COMPLETE_PIPELINES = 12;
const MAX_UNIQUE_PROPOSALS = 48;

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
}

interface LocalSearchInput {
	readonly graph: LogicGraph;
	readonly structure: LayoutStructure;
	readonly measurements: LayoutMeasurements;
	readonly domain: RankOrderDomain;
	readonly budgets: SearchBudgets;
	readonly evaluate: typeof evaluateDedicatedLayout;
}

interface ComponentSearchInput {
	readonly component: RankSearchComponent;
	readonly global: RankOrderDomain;
	readonly indices: readonly number[];
	readonly limit: number;
	readonly evaluate: typeof evaluateDedicatedLayout;
}

interface ComponentSearchResult {
	readonly evidence: ComponentEvidence;
	readonly matched: readonly number[];
	readonly selected: RankOrder;
}

/** Scale the local pipeline budget at the frontier instead of dropping an entire component. */
function localPipelineLimit(relationCount: number): number {
	const work = relationCount * (relationCount + 1);
	return Math.min(MAX_COMPLETE_PIPELINES, Math.floor(MAX_ESTIMATED_ROUTE_WORK / work));
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

/** Count only local relations once, including routes projected through enclosing groups. */
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
	for (const { relation } of graph.relations) {
		const source = defined(byEndpoint.get(relation.from));
		const target = defined(byEndpoint.get(relation.to));
		if (bands.has(source)) counts.set(source, defined(counts.get(source)) + 1);
		if (target !== source && bands.has(target)) counts.set(target, defined(counts.get(target)) + 1);
	}
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
			if (defined(global.locations[globalIndex]).rank !== location.rank) return false;
			const original = defined(global.bands[globalIndex]);
			return original.length === ids.length && ids.every((id) => original.includes(id));
		});
		matched.push(defined(candidate));
	}
	return matched;
}

function searchComponent(input: ComponentSearchInput): ComponentSearchResult {
	const { component, global, indices, limit, evaluate } = input;
	const structure = prepareLayout(component.graph, component.ranks);
	const domain = collectRankOrderDomain(structure);
	const matched = matchingBands(global, indices, domain);
	const baseline = evaluate(structure, component.measurements, {}, true);
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
	return {
		evidence: {
			ids: component.ids,
			witness: search.witness,
			pipelineLimit: limit,
			estimatedRouteWork:
				search.witness.evaluated * component.relationCount * (component.relationCount + 1),
			selected,
		},
		matched,
		selected,
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
	const { graph, structure, measurements, domain, budgets, evaluate } = input;
	const orders = domain.bands.map((band) => [...band]);
	const changed = new Set<number>();
	const evidence: ComponentEvidence[] = [];
	if (budgets.limits.size === 0)
		return { orders, changed, evidence, skippedComponents: budgets.skippedComponents };
	const components = rankSearchComponents(
		graph,
		structure,
		measurements,
		new Set(budgets.limits.keys()),
	);
	for (const component of components) {
		const searched = searchComponent({
			component,
			global: domain,
			indices: defined(budgets.bands.get(component.index)),
			limit: defined(budgets.limits.get(component.index)),
			evaluate,
		});
		evidence.push(searched.evidence);
		if (recordSelectedBands(domain, searched, orders)) changed.add(component.index);
	}
	return { orders, changed, evidence, skippedComponents: budgets.skippedComponents };
}
