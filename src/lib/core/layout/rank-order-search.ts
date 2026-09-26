import {
	compareDedicatedRouteScores,
	validateDedicatedCandidate,
} from './dedicated-candidate-validation';
import type {
	DedicatedRouteScore,
	RejectedDedicatedCandidate,
} from './dedicated-candidate-validation/types';
import type { DedicatedLayoutEvaluation, LayoutMeasurements, LayoutOptions } from './layout-types';
import {
	boundedRankOrderEnumerationSize,
	compareRankOrders,
	lazyRankOrders,
	type RankOrder,
	rankOrderKendallDistance,
} from './rank-order';
import { adjacentOrders, barycentricSweep } from './rank-order-heuristic';
import { RankTopologyOracle } from './rank-order-topology';
import type { RankOrderDomain } from './rank-ordering';
import type { LayoutStructure } from './structure/prepare-layout';

/** Rank selection only needs the retained evaluation path of the dedicated engine. */
export type DedicatedLayoutEvaluator = (
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	options: LayoutOptions | undefined,
	retainForCompletion: true,
) => DedicatedLayoutEvaluation;

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

interface ValidRankOrderCandidate {
	readonly order: RankOrder;
	readonly evaluation: DedicatedLayoutEvaluation;
	readonly topologyCrossings: number;
	readonly routeScore: DedicatedRouteScore;
	readonly kendall: number;
}

export interface RankOrderSearchInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
	readonly measurements: LayoutMeasurements;
	readonly baseline: DedicatedLayoutEvaluation;
	readonly evaluate: (order: RankOrder) => DedicatedLayoutEvaluation;
	readonly limits: { readonly completePipelines: number; readonly uniqueProposals: number };
}

export interface RankOrderSearchResult {
	readonly selected: ValidRankOrderCandidate | undefined;
	readonly unchangedBaseline: DedicatedLayoutEvaluation;
	readonly witness: RankOrderSearchWitness;
}

/** No rank edit can improve bridge-free documentary routes or zero documentary inversions. */
function documentaryNeedsNoSearch(candidate: ValidRankOrderCandidate): boolean {
	if (candidate.routeScore.strictCrossings === 0 && candidate.routeScore.validatedBridges === 0)
		return true;
	return candidate.topologyCrossings === 0 && candidate.kendall === 0;
}

class RankOrderSearch {
	mode = RankSearchMode.Skipped;
	stop = RankSearchStop.NoBand;
	proposed = 1;
	evaluated = 1;
	valid = 0;
	unverified = 0;
	validations = 0;
	routeRunsInspected = 0;
	readonly rejected: { order: RankOrder; reason: RejectedDedicatedCandidate }[] = [];
	selected: ValidRankOrderCandidate | undefined;
	exhaustive = true;
	truncated = false;
	private readonly seen: Set<string>;
	private readonly frontier: RankOrder[];
	private readonly topology: RankTopologyOracle;
	private documentaryScore: DedicatedRouteScore | undefined;

	constructor(private readonly input: RankOrderSearchInput) {
		this.seen = new Set([JSON.stringify(input.domain.bands)]);
		this.frontier = [input.domain.bands];
		this.topology = new RankTopologyOracle(input.structure, input.domain);
	}

	result(): RankOrderSearchResult {
		return {
			selected: this.selected,
			unchangedBaseline: this.input.baseline,
			witness: {
				mode: this.mode,
				stop: this.stop,
				proposed: this.proposed,
				evaluated: this.evaluated,
				valid: this.valid,
				rejected: this.rejected,
				selectedOrder: this.selected?.order ?? this.input.domain.bands,
				unverified: this.unverified,
				work: {
					completePipelines: this.evaluated,
					validations: this.validations,
					routeRunsInspected: this.routeRunsInspected,
				},
				exhaustive: this.exhaustive,
				truncated: this.truncated,
			},
		};
	}

	verify(order: RankOrder, evaluation: DedicatedLayoutEvaluation, documentary = false): void {
		const { structure, measurements } = this.input;
		this.validations += 1;
		const outcome = validateDedicatedCandidate({
			graph: structure.graph,
			ranks: structure.ranks,
			measurements,
			layout: evaluation.result,
		});
		if (!outcome.valid) {
			this.routeRunsInspected += outcome.inspectedRuns ?? 0;
			this.rejected.push({ order, reason: outcome });
			return;
		}
		this.routeRunsInspected += outcome.analysis.inspectedRuns;
		if (documentary) this.documentaryScore = outcome.score;
		else if (
			this.documentaryScore !== undefined &&
			compareDedicatedRouteScores(outcome.score, this.documentaryScore) > 0
		)
			return;
		this.valid += 1;
		const candidate = {
			order,
			evaluation,
			topologyCrossings: this.topology.count(structure, order),
			routeScore: outcome.score,
			kendall: rankOrderKendallDistance(order, this.input.domain.bands),
		};
		this.selected = candidate;
	}

	private cutOff(stop: RankSearchStop): false {
		this.stop = stop;
		this.truncated = true;
		this.exhaustive = false;
		return false;
	}

	/** A dominated rank order cannot win even with perfect routes; still explore its neighbors. */
	private cannotBeatSelected(order: RankOrder): boolean {
		const best = this.selected;
		if (best === undefined) return false;
		const crossings = this.topology.count(this.input.structure, order, best.topologyCrossings);
		if (crossings !== best.topologyCrossings) return crossings > best.topologyCrossings;
		const kendall = rankOrderKendallDistance(order, this.input.domain.bands);
		if (kendall !== best.kendall) return kendall > best.kendall;
		return compareRankOrders(order, best.order) >= 0;
	}

	propose(order: RankOrder): boolean {
		const key = JSON.stringify(order);
		if (this.seen.has(key)) return true;
		if (this.proposed >= this.input.limits.uniqueProposals)
			return this.cutOff(RankSearchStop.ProposalBudget);
		this.seen.add(key);
		this.proposed += 1;
		this.frontier.push(order);
		if (this.cannotBeatSelected(order)) return true;
		if (this.evaluated >= this.input.limits.completePipelines)
			return this.cutOff(RankSearchStop.EvaluationBudget);
		this.evaluated += 1;
		this.verify(order, this.input.evaluate(order));
		return true;
	}

	runExact(): void {
		this.mode = RankSearchMode.Exact;
		for (const order of lazyRankOrders(this.input.domain, this.input.domain.bands))
			if (!this.propose(order)) return;
		this.stop = RankSearchStop.Complete;
	}

	runHeuristic(): void {
		this.mode = RankSearchMode.Heuristic;
		let current: RankOrder = this.input.domain.bands;
		for (const reverse of [false, true]) {
			current = barycentricSweep(this.input, current, reverse);
			if (!this.propose(current)) return;
		}
		this.localImprovements();
		if (this.truncated) return;
		for (const source of this.frontier)
			for (const order of adjacentOrders(source)) if (!this.propose(order)) return;
		this.stop = RankSearchStop.Complete;
	}

	private localImprovements(): void {
		let changed = true;
		while (changed) {
			changed = false;
			const best = this.selected;
			if (best === undefined) return;
			for (const order of adjacentOrders(best.order)) {
				if (!this.propose(order)) return;
				if (this.selected !== best) changed = true;
			}
		}
	}
}

/** Scores only complete, independently validated LayoutResults; the baseline is never rerun. */
export function searchDedicatedRankOrders(input: RankOrderSearchInput): RankOrderSearchResult {
	const search = new RankOrderSearch(input);
	search.verify(input.domain.bands, input.baseline, true);
	const documentary = search.selected;
	if (documentary !== undefined && documentaryNeedsNoSearch(documentary)) {
		search.stop = RankSearchStop.OptimalBound;
		search.exhaustive = true;
		return search.result();
	}
	if (boundedRankOrderEnumerationSize(input.domain, input.limits.completePipelines) !== undefined)
		search.runExact();
	else search.runHeuristic();
	if (search.selected === undefined) search.stop = RankSearchStop.BaselineFallback;
	return search.result();
}
