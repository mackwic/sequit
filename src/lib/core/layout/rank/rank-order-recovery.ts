import type { TopologicalRanks } from '../../graph/topological-ranks';
import type {
	GroupRouteFailure,
	LayoutMeasurements,
	LayoutOptions,
	LayoutResult,
} from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import {
	MAX_COMPLETE_PIPELINES,
	MAX_UNIQUE_PROPOSALS,
	type SearchBudgets,
} from './rank-order-local';
import { type DedicatedLayoutEvaluator, searchDedicatedRankOrders } from './rank-order-search';
import type { RankOrderSearchWitness } from './rank-order-witness';
import { applyRankOrder, type RankOrderDomain } from './rank-ordering';

export interface SelectionServices {
	readonly options: LayoutOptions;
	readonly evaluate: DedicatedLayoutEvaluator;
	readonly admit?: ((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
}

export interface RecoveryInput {
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
	readonly budgets: SearchBudgets;
	readonly services: SelectionServices;
	readonly failure: GroupRouteFailure;
}

/** The documentary layout has no geometry to reuse; search complete global candidates directly. */
export function recoverDocumentaryFailure(input: RecoveryInput): {
	readonly layout: LayoutResult;
	readonly witness: RankOrderSearchWitness;
} {
	const { structure, domain, measurements, budgets, services, ranks, failure } = input;
	let completePipelines = 0;
	for (const limit of budgets.limits.values()) completePipelines += limit;
	let minimumPipelines = 1;
	if (domain.bands.some((band) => band.length > 1)) minimumPipelines = 2;
	completePipelines = Math.max(
		minimumPipelines,
		Math.min(MAX_COMPLETE_PIPELINES, completePipelines),
	);
	let admissions = 0;
	const admit = services.admit;
	const search = searchDedicatedRankOrders({
		structure,
		domain,
		measurements,
		baseline: failure,
		evaluate: (order) =>
			services.evaluate(
				applyRankOrder(structure, domain, order),
				measurements,
				services.options,
				true,
			),
		...(admit !== undefined && {
			admit: (layout: LayoutResult) => {
				admissions += 1;
				return admit(layout, ranks);
			},
		}),
		limits: { completePipelines, uniqueProposals: MAX_UNIQUE_PROPOSALS },
	});
	const selected = search.selected;
	if (selected === undefined) throw failure;
	return {
		layout: selected.evaluation.complete(),
		witness: {
			...search.witness,
			finalValidation: { valid: true },
			work: {
				...search.witness.work,
				globalCompletePipelines: search.witness.work.completePipelines,
				globalValidations: search.witness.work.validations,
				incidentAdmissions: admissions,
			},
		},
	};
}
