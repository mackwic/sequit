import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { compareDedicatedRouteScores } from '../dedicated-candidate-validation/route-score';
import type {
	DedicatedRouteScore,
	RejectedDedicatedCandidate,
} from '../dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../dedicated-candidate-validation/validate';
import {
	type DedicatedCandidateFailure,
	type DedicatedLayoutEvaluation,
	isDedicatedCandidateFailure,
	type LayoutMeasurements,
} from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { LocalChoice, SearchBudgets } from './rank-order-local';
import { searchGlobalOrders, type SelectionServices } from './rank-order-recovery';
import { failureRejection } from './rank-order-search';
import type { RankOrderSearchWitness } from './rank-order-witness';
import { applyRankOrder, type RankOrderDomain } from './rank-ordering';

export interface GlobalChoice {
	readonly evaluation: DedicatedLayoutEvaluation;
	readonly pipelines: number;
	readonly validations: number;
	readonly runsInspected: number;
	readonly incidentAdmissions: number;
	readonly finalValidation?: RankOrderSearchWitness['finalValidation'];
	readonly fallbackComponents: readonly (readonly string[])[];
	/** No validation on the whole document covers the published layout. */
	readonly unverified: boolean;
	/** The whole-document order search that replaced a rejected documentary assembly. */
	readonly repair?: RankOrderSearchWitness;
}

export interface AssemblyInput {
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

function rejectedRenderedQuality(
	baseline: ReturnType<typeof validateDedicatedCandidate>,
	trialScore: DedicatedRouteScore,
): boolean {
	if (!baseline.valid) return false;
	return compareDedicatedRouteScores(trialScore, baseline.score) > 0;
}

function evaluateAssembled(
	input: AssemblyInput,
): DedicatedLayoutEvaluation | DedicatedCandidateFailure {
	const { structure, domain, local, measurements, services } = input;
	try {
		return services.evaluate(
			applyRankOrder(structure, domain, local.orders),
			measurements,
			services.options,
			true,
		);
	} catch (error) {
		if (isDedicatedCandidateFailure(error)) return error;
		throw error;
	}
}

interface AssemblyWork {
	pipelines: number;
	validations: number;
	runsInspected: number;
	incidentAdmissions: number;
	finalValidation?: RankOrderSearchWitness['finalValidation'];
	readonly fallbackComponents: (readonly string[])[];
}

/**
 * Component searches validate their own slices only, while rails and rank gaps are shared: an
 * assembly is published once validated on the whole document, or replaced by a whole-document
 * order search when rejected. Without any affordable search, the documentary layout is published
 * and witnessed unverified.
 */
export function assembleGlobal(input: AssemblyInput): GlobalChoice {
	const { graph, ranks, measurements, baseline, local } = input;
	const settled = local.provenBaseline || local.evidence.length === 0;
	if (local.changed.size === 0 && settled)
		return {
			evaluation: baseline,
			pipelines: 1,
			validations: 0,
			runsInspected: 0,
			incidentAdmissions: 0,
			fallbackComponents: [],
			unverified: !local.provenBaseline,
		};
	const documentary = validateDedicatedCandidate({
		graph,
		ranks,
		measurements,
		layout: baseline.result,
	});
	let runsInspected: number;
	if (documentary.valid) runsInspected = documentary.analysis.inspectedRuns;
	else runsInspected = documentary.inspectedRuns ?? 0;
	const work: AssemblyWork = {
		pipelines: 1,
		validations: 1,
		runsInspected,
		incidentAdmissions: 0,
		fallbackComponents: [],
	};
	const trial = assembleTrials(input, documentary, work);
	if (trial !== undefined) return { ...work, evaluation: trial, unverified: false };
	if (documentary.valid)
		return {
			...work,
			evaluation: baseline,
			finalValidation: work.finalValidation ?? { valid: true },
			unverified: false,
		};
	return repairAssembly(input, documentary, work);
}

/** Validate each assembled trial; every rejection removes at least one component edit. */
function assembleTrials(
	input: AssemblyInput,
	documentary: ReturnType<typeof validateDedicatedCandidate>,
	work: AssemblyWork,
): DedicatedLayoutEvaluation | undefined {
	const { graph, ranks, measurements, budgets, local, services } = input;
	const owners = relationOwners(graph, budgets.byEndpoint);
	while (local.changed.size > 0) {
		work.pipelines += 1;
		work.validations += 1;
		const trial = evaluateAssembled(input);
		if (isDedicatedCandidateFailure(trial)) {
			const failure = failureRejection(trial);
			work.finalValidation = failure;
			work.fallbackComponents.push(
				...restoreDocumentary(
					input,
					faultyComponents(failure, local.changed, budgets.byEndpoint, owners),
				),
			);
			continue;
		}
		const outcome = validateDedicatedCandidate({
			graph,
			ranks,
			measurements,
			layout: trial.result,
		});
		if (!outcome.valid) {
			work.runsInspected += outcome.inspectedRuns ?? 0;
			work.finalValidation = outcome;
			work.fallbackComponents.push(
				...restoreDocumentary(
					input,
					faultyComponents(outcome, local.changed, budgets.byEndpoint, owners),
				),
			);
			continue;
		}
		work.runsInspected += outcome.analysis.inspectedRuns;
		work.finalValidation = { valid: true };
		if (rejectedRenderedQuality(documentary, outcome.score)) {
			work.fallbackComponents.push(...restoreDocumentary(input, new Set(local.changed)));
			continue;
		}
		if (services.admit !== undefined) work.incidentAdmissions += 1;
		// Partial incident conflicts have no reliable component provenance; restore every rank edit.
		if (services.admit?.(trial.result, ranks) === false) {
			work.fallbackComponents.push(...restoreDocumentary(input, new Set(local.changed)));
			continue;
		}
		return trial;
	}
	return undefined;
}

/**
 * The documentary assembly was rejected on the whole document. A single search over the whole
 * document already was the global search; otherwise search orders validated globally, within the
 * existing pipeline budget. Without a valid order, the documentary layout stays published and its
 * witness carries the rejection: it never claims a validation it failed.
 */
function repairAssembly(
	input: AssemblyInput,
	documentary: RejectedDedicatedCandidate,
	work: AssemblyWork,
): GlobalChoice {
	// Published although rejected: the witness says unverified and keeps the rejection.
	const rejectedBaseline = {
		...work,
		evaluation: input.baseline,
		finalValidation: documentary,
		unverified: true,
	};
	if (input.local.wholeDocument) return rejectedBaseline;
	const { search, admissions } = searchGlobalOrders({ ...input, failure: documentary });
	const repair = search.witness;
	// The search counts the documentary order as evaluated without routing it again.
	const searched = {
		pipelines: work.pipelines + repair.evaluated - 1,
		validations: work.validations + repair.work.validations,
		runsInspected: work.runsInspected + repair.work.routeRunsInspected,
		incidentAdmissions: work.incidentAdmissions + admissions,
		repair,
	};
	const selected = search.selected;
	if (selected === undefined) return { ...rejectedBaseline, ...searched };
	return {
		...searched,
		evaluation: selected.evaluation,
		fallbackComponents: work.fallbackComponents,
		finalValidation: { valid: true },
		unverified: false,
	};
}
