import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { RejectedDedicatedCandidate } from '../dedicated-candidate-validation/types';
import {
	type DedicatedLayoutEvaluation,
	isDedicatedCandidateFailure,
	type LayoutMeasurements,
	type LayoutResult,
} from '../layout-types';
import { prepareLayout } from '../structure/prepare-layout';
import type { RankOrder } from './rank-order';
import { assembleGlobal, type GlobalChoice } from './rank-order-assembly';
import {
	chooseLocal,
	type LocalChoice,
	type SearchBudgets,
	searchBudgets,
} from './rank-order-local';
import { recoverDocumentaryFailure, type SelectionServices } from './rank-order-recovery';
import { type RankOrderSearchWitness, RankSearchMode, RankSearchStop } from './rank-order-witness';
import { collectRankOrderDomain } from './rank-ordering';

interface SearchTally {
	mode: RankSearchMode;
	stop: RankSearchStop;
	proposed: number;
	evaluated: number;
	valid: number;
	unverified: number;
	validations: number;
	runs: number;
	truncated: boolean;
	exhaustive: boolean;
	selectedOrder: RankOrder;
	readonly rejected: { order: RankOrder; reason: RejectedDedicatedCandidate }[];
}

function tallyLocal(local: LocalChoice): SearchTally {
	const tally: SearchTally = {
		mode: RankSearchMode.Skipped,
		stop: RankSearchStop.NoBand,
		proposed: 0,
		evaluated: 0,
		valid: 0,
		unverified: 0,
		validations: 0,
		runs: 0,
		truncated: false,
		exhaustive: local.skippedComponents === 0,
		selectedOrder: local.orders,
		rejected: [],
	};
	for (const { witness } of local.evidence) {
		tally.proposed += witness.proposed;
		tally.evaluated += witness.evaluated;
		tally.valid += witness.valid;
		tally.unverified += witness.unverified;
		tally.validations += witness.work.validations;
		tally.runs += witness.work.routeRunsInspected;
		tally.rejected.push(...witness.rejected);
		tally.truncated ||= witness.truncated;
		tally.exhaustive &&= witness.exhaustive;
		if (witness.mode === RankSearchMode.Heuristic || tally.mode === RankSearchMode.Skipped)
			tally.mode = witness.mode;
		if (witness.truncated || tally.stop === RankSearchStop.NoBand) tally.stop = witness.stop;
	}
	return tally;
}

/** The repair search judged the documentary order the assembly already counted. */
function tallyRepair(tally: SearchTally, repair: RankOrderSearchWitness): void {
	tally.proposed += repair.proposed - 1;
	tally.evaluated += repair.evaluated - 1;
	tally.valid += repair.valid;
	tally.rejected.push(...repair.rejected);
	tally.truncated ||= repair.truncated;
	tally.exhaustive &&= repair.exhaustive;
	tally.stop = repair.stop;
	tally.selectedOrder = repair.selectedOrder;
}

function selectionWitness(
	budgets: SearchBudgets,
	local: LocalChoice,
	global: GlobalChoice,
): RankOrderSearchWitness {
	const tally = tallyLocal(local);
	if (local.evidence.length === 0 && budgets.bands.size > 0)
		tally.stop = RankSearchStop.ShapeEnvelope;
	if (global.fallbackComponents.length > 0) tally.stop = RankSearchStop.BaselineFallback;
	if (global.unverified) tally.unverified = 1;
	const localPipelines = tally.evaluated;
	if (global.repair !== undefined) tallyRepair(tally, global.repair);
	const extras: {
		skippedComponents?: number;
		fallbackComponents?: readonly (readonly string[])[];
		finalValidation?: NonNullable<RankOrderSearchWitness['finalValidation']>;
	} = {};
	if (local.skippedComponents > 0) extras.skippedComponents = local.skippedComponents;
	if (global.fallbackComponents.length > 0) extras.fallbackComponents = global.fallbackComponents;
	if (global.finalValidation !== undefined) extras.finalValidation = global.finalValidation;
	return {
		mode: tally.mode,
		stop: tally.stop,
		proposed: Math.max(1, tally.proposed),
		evaluated: Math.max(1, tally.evaluated),
		valid: tally.valid,
		rejected: tally.rejected,
		unverified: tally.unverified,
		selectedOrder: tally.selectedOrder,
		...extras,
		components: local.evidence,
		work: {
			completePipelines: localPipelines + global.pipelines,
			validations: tally.validations + global.validations,
			routeRunsInspected: tally.runs + global.runsInspected,
			localCompletePipelines: localPipelines,
			globalCompletePipelines: global.pipelines,
			globalValidations: global.validations,
			incidentAdmissions: global.incidentAdmissions,
		},
		// Local frontiers and the whole-document repair search only, never a global score proof.
		exhaustive: tally.exhaustive,
		truncated: tally.truncated,
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
	let baseline: DedicatedLayoutEvaluation;
	try {
		baseline = services.evaluate(structure, measurements, services.options, true);
	} catch (error) {
		if (!isDedicatedCandidateFailure(error)) throw error;
		return recoverDocumentaryFailure({
			ranks,
			measurements,
			structure,
			domain,
			budgets: searchBudgets(graph, structure, domain),
			services,
			failure: error,
		});
	}
	const budgets = searchBudgets(graph, structure, domain);
	const local = chooseLocal({
		graph,
		structure,
		measurements,
		baseline,
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
