import type { RejectedDedicatedCandidate } from '../dedicated-candidate-validation/types';
import type { RankOrder } from './rank-order';

export enum RankSearchMode {
	Skipped = 'skipped',
	Exact = 'exact',
	Heuristic = 'heuristic',
}

export enum RankSearchStop {
	ShapeEnvelope = 'shape-envelope',
	NoBand = 'no-band',
	BaselineFallback = 'baseline-fallback',
	Complete = 'complete',
	OptimalBound = 'optimal-bound',
	/** A candidate routes without crossing or bridge: closer orders are not looked for. */
	CrossingFree = 'crossing-free',
	EvaluationBudget = 'evaluation-budget',
	ProposalBudget = 'proposal-budget',
}

interface ValidFinalRankValidation {
	readonly valid: true;
}

export interface RankOrderSearchWitness {
	readonly mode: RankSearchMode;
	readonly stop: RankSearchStop;
	readonly proposed: number;
	readonly evaluated: number;
	readonly valid: number;
	readonly rejected: readonly {
		readonly order: RankOrder;
		readonly reason: RejectedDedicatedCandidate;
	}[];
	readonly unverified: number;
	/** Final per-rank order, after all validation and component-level fallbacks. */
	readonly selectedOrder: RankOrder;
	/** Diagnostic of individually searched weak components; their scores are not global optima. */
	readonly components?: readonly {
		readonly ids: readonly string[];
		readonly witness: RankOrderSearchWitness;
		readonly pipelineLimit: number;
		readonly selected: RankOrder;
	}[];
	readonly skippedComponents?: number;
	readonly fallbackComponents?: readonly (readonly string[])[];
	readonly finalValidation?: RejectedDedicatedCandidate | ValidFinalRankValidation;
	readonly work: {
		/** The per-component pipelines never process unrelated routes. */
		readonly completePipelines: number;
		readonly validations: number;
		readonly routeRunsInspected: number;
		readonly localCompletePipelines?: number;
		readonly globalCompletePipelines?: number;
		readonly globalValidations?: number;
		readonly incidentAdmissions?: number;
	};
	readonly exhaustive: boolean;
	readonly truncated: boolean;
}
