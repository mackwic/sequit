import { defined } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import {
	compareDedicatedRouteScores,
	validateDedicatedCandidate,
} from './dedicated-candidate-validation';
import type {
	DedicatedRouteScore,
	RejectedDedicatedCandidate,
} from './dedicated-candidate-validation/types';
import type { DedicatedLayoutEvaluation, evaluateDedicatedLayout } from './layout-engine';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import type { RankOrder } from './rank-order';
import {
	chooseLocal,
	type LocalChoice,
	type SearchBudgets,
	searchBudgets,
} from './rank-order-local';
import { type RankOrderSearchWitness, RankSearchMode, RankSearchStop } from './rank-order-search';
import { applyRankOrder, collectRankOrderDomain, type RankOrderDomain } from './rank-ordering';
import { type LayoutStructure, prepareLayout } from './structure/prepare-layout';

interface GlobalChoice {
	readonly evaluation: DedicatedLayoutEvaluation;
	readonly pipelines: number;
	readonly validations: number;
	readonly runsInspected: number;
	readonly incidentAdmissions: number;
	readonly finalValidation?: RankOrderSearchWitness['finalValidation'];
	readonly fallbackComponents: readonly (readonly string[])[];
}

export interface RejectedRankAdmission {
	readonly accepted: false;
	readonly endpointIds: readonly [string, ...string[]];
	readonly relationIds: readonly string[];
}

export type RankAdmission = boolean | RejectedRankAdmission;

interface SelectionServices {
	readonly options: LayoutOptions;
	readonly evaluate: typeof evaluateDedicatedLayout;
	readonly admit?: ((layout: LayoutResult, ranks: TopologicalRanks) => RankAdmission) | undefined;
}

interface AssemblyInput {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
	readonly baseline: DedicatedLayoutEvaluation;
	readonly budgets: SearchBudgets;
	readonly local: LocalChoice;
	readonly services: SelectionServices;
}

function faultyComponents(
	failure: RejectedDedicatedCandidate,
	modified: ReadonlySet<number>,
	byEndpoint: ReadonlyMap<string, number>,
	byRelation: ReadonlyMap<string, readonly number[]>,
): ReadonlySet<number> {
	const implicated = new Set<number>();
	for (const id of [failure.endpointId, failure.otherEndpointId]) {
		const index = byEndpoint.get(id ?? '');
		if (index !== undefined && modified.has(index)) implicated.add(index);
	}
	for (const id of [failure.relationId, failure.otherRelationId])
		for (const index of byRelation.get(id ?? '') ?? [])
			if (modified.has(index)) implicated.add(index);
	// An inventory/canvas failure or a fault in an untouched component has no safe attribution.
	if (implicated.size === 0) return modified;
	return implicated;
}

function relationOwners(
	graph: LogicGraph,
	byEndpoint: ReadonlyMap<string, number>,
): ReadonlyMap<string, readonly number[]> {
	return new Map(
		graph.relations.map(({ relation }) => {
			const source = defined(byEndpoint.get(relation.from));
			const target = defined(byEndpoint.get(relation.to));
			const indices = [source];
			if (target !== source) indices.push(target);
			return [relation.id, indices] as const;
		}),
	);
}

function restoreDocumentary(
	input: AssemblyInput,
	components: ReadonlySet<number>,
): readonly (readonly string[])[] {
	const { local, budgets, domain, structure } = input;
	const fallen: (readonly string[])[] = [];
	for (const index of components) {
		fallen.push(defined(structure.components[index]).ids);
		for (const bandIndex of defined(budgets.bands.get(index)))
			local.orders[bandIndex] = [...defined(domain.bands[bandIndex])];
		local.changed.delete(index);
	}
	return fallen;
}

function faultyAdmissionComponents(
	failure: RankAdmission,
	modified: ReadonlySet<number>,
	byEndpoint: ReadonlyMap<string, number>,
	byRelation: ReadonlyMap<string, readonly number[]>,
): ReadonlySet<number> {
	if (typeof failure === 'boolean') return modified;
	const implicated = new Set<number>();
	for (const id of failure.endpointIds) {
		const index = byEndpoint.get(id);
		if (index === undefined || !modified.has(index)) return modified;
		implicated.add(index);
	}
	for (const id of failure.relationIds) {
		const indices = byRelation.get(id);
		if (indices === undefined) return modified;
		for (const index of indices) {
			if (!modified.has(index)) return modified;
			implicated.add(index);
		}
	}
	return implicated;
}

function rejectedRenderedQuality(
	baseline: ReturnType<typeof validateDedicatedCandidate>,
	trialScore: DedicatedRouteScore,
): boolean {
	if (!baseline.valid) return false;
	return compareDedicatedRouteScores(trialScore, baseline.score) > 0;
}

/** Validate the baseline once, then each assembled trial; every rejection removes at least one edit. */
function assembleGlobal(input: AssemblyInput): GlobalChoice {
	const { graph, ranks, measurements, structure, domain, baseline, budgets, local, services } =
		input;
	if (local.changed.size === 0)
		return {
			evaluation: baseline,
			pipelines: 1,
			validations: 0,
			runsInspected: 0,
			incidentAdmissions: 0,
			fallbackComponents: [],
		};
	const documentary = validateDedicatedCandidate({
		graph,
		ranks,
		measurements,
		layout: baseline.result,
	});
	const owners = relationOwners(graph, budgets.byEndpoint);
	const fallbackComponents: (readonly string[])[] = [];
	let pipelines = 1;
	let validations = 1;
	let runsInspected: number;
	if (documentary.valid) runsInspected = documentary.analysis.inspectedRuns;
	else runsInspected = documentary.inspectedRuns ?? 0;
	let incidentAdmissions = 0;
	let finalValidation: RankOrderSearchWitness['finalValidation'];
	while (local.changed.size > 0) {
		const trial = services.evaluate(
			applyRankOrder(structure, domain, local.orders),
			measurements,
			services.options,
			true,
		);
		pipelines += 1;
		validations += 1;
		const outcome = validateDedicatedCandidate({
			graph,
			ranks,
			measurements,
			layout: trial.result,
		});
		if (!outcome.valid) {
			runsInspected += outcome.inspectedRuns ?? 0;
			finalValidation = outcome;
			fallbackComponents.push(
				...restoreDocumentary(
					input,
					faultyComponents(outcome, local.changed, budgets.byEndpoint, owners),
				),
			);
			continue;
		}
		runsInspected += outcome.analysis.inspectedRuns;
		finalValidation = { valid: true };
		if (rejectedRenderedQuality(documentary, outcome.score)) {
			fallbackComponents.push(...restoreDocumentary(input, new Set(local.changed)));
			continue;
		}
		if (services.admit !== undefined) incidentAdmissions += 1;
		const admission = services.admit?.(trial.result, ranks) ?? true;
		if (admission !== true) {
			const faulty = faultyAdmissionComponents(
				admission,
				local.changed,
				budgets.byEndpoint,
				owners,
			);
			fallbackComponents.push(...restoreDocumentary(input, faulty));
			continue;
		}
		return {
			evaluation: trial,
			pipelines,
			validations,
			runsInspected,
			incidentAdmissions,
			fallbackComponents,
			finalValidation,
		};
	}
	return {
		evaluation: baseline,
		pipelines,
		validations,
		runsInspected,
		incidentAdmissions,
		fallbackComponents,
		...(finalValidation !== undefined && { finalValidation }),
	};
}

function selectionWitness(
	budgets: SearchBudgets,
	local: LocalChoice,
	global: GlobalChoice,
): RankOrderSearchWitness {
	let mode = RankSearchMode.Skipped;
	let stop = RankSearchStop.NoBand;
	let proposed = 0;
	let evaluated = 0;
	let valid = 0;
	let unverified = 0;
	let localValidations = 0;
	let localRuns = 0;
	let truncated = false;
	let exhaustive = local.skippedComponents === 0;
	const rejected: { order: RankOrder; reason: RejectedDedicatedCandidate }[] = [];
	for (const { witness } of local.evidence) {
		proposed += witness.proposed;
		evaluated += witness.evaluated;
		valid += witness.valid;
		unverified += witness.unverified;
		localValidations += witness.work.validations;
		localRuns += witness.work.routeRunsInspected;
		rejected.push(...witness.rejected);
		truncated ||= witness.truncated;
		exhaustive &&= witness.exhaustive;
		if (witness.mode === RankSearchMode.Heuristic || mode === RankSearchMode.Skipped)
			mode = witness.mode;
		if (witness.truncated || stop === RankSearchStop.NoBand) stop = witness.stop;
	}
	if (local.evidence.length === 0 && budgets.bands.size > 0) stop = RankSearchStop.ShapeEnvelope;
	if (global.fallbackComponents.length > 0) stop = RankSearchStop.BaselineFallback;
	if (budgets.bands.size === 0) unverified = 1;
	const localPipelines = evaluated;
	if (evaluated === 0) evaluated = 1;
	if (proposed === 0) proposed = 1;
	const extras: {
		skippedComponents?: number;
		fallbackComponents?: readonly (readonly string[])[];
		finalValidation?: NonNullable<RankOrderSearchWitness['finalValidation']>;
	} = {};
	if (local.skippedComponents > 0) extras.skippedComponents = local.skippedComponents;
	if (global.fallbackComponents.length > 0) extras.fallbackComponents = global.fallbackComponents;
	if (global.finalValidation !== undefined) extras.finalValidation = global.finalValidation;
	return {
		mode,
		stop,
		proposed,
		evaluated,
		valid,
		rejected,
		unverified,
		selectedOrder: local.orders,
		...extras,
		components: local.evidence,
		work: {
			completePipelines: localPipelines + global.pipelines,
			validations: localValidations + global.validations,
			routeRunsInspected: localRuns + global.runsInspected,
			localCompletePipelines: localPipelines,
			globalCompletePipelines: global.pipelines,
			globalValidations: global.validations,
			incidentAdmissions: global.incidentAdmissions,
		},
		// This only describes the local search frontier, never a global score proof.
		exhaustive,
		truncated,
	};
}

/** Local scores are proposal heuristics: global rails and rank gaps are shared across components. */
export function selectDedicatedRankLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	services: SelectionServices,
): { readonly layout: LayoutResult; readonly witness: RankOrderSearchWitness } {
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const baseline = services.evaluate(structure, measurements, services.options, true);
	const budgets = searchBudgets(graph, structure, domain);
	const local = chooseLocal({
		graph,
		structure,
		measurements,
		domain,
		budgets,
		evaluate: services.evaluate,
	});
	const global = assembleGlobal({
		graph,
		ranks,
		measurements,
		structure,
		domain,
		baseline,
		budgets,
		local,
		services,
	});
	return {
		layout: global.evaluation.complete(),
		witness: selectionWitness(budgets, local, global),
	};
}
