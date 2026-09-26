import { defined } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import {
	compareDedicatedRouteScores,
	validateDedicatedCandidate,
} from './dedicated-candidate-validation';
import type {
	DedicatedRouteScore,
	RejectedDedicatedCandidate,
} from './dedicated-candidate-validation/types';
import type { DedicatedLayoutEvaluation } from './layout-engine';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import {
	boundedRankOrderEnumerationSize,
	compareRankOrders,
	lazyRankOrders,
	type RankOrder,
	rankOrderKendallDistance,
} from './rank-order';
import { adjacentOrders, barycentricSweep } from './rank-order-heuristic';
import type { RankOrderDomain } from './rank-ordering';
import type { LayoutStructure } from './structure/prepare-layout';

export enum RankSearchMode {
	Skipped = 'skipped',
	Exact = 'exact',
	Heuristic = 'heuristic',
}

export enum RankSearchStop {
	ShapeEnvelope = 'shape-envelope',
	NoBand = 'no-band',
	NoRelevantCrossing = 'no-relevant-crossing',
	BaselineRejected = 'baseline-rejected',
	Complete = 'complete',
	OptimalBound = 'optimal-bound',
	EvaluationBudget = 'evaluation-budget',
	ProposalBudget = 'proposal-budget',
}
export enum RankSearchRejectionCode {
	IncidentInfeasible = 'incident-infeasible',
}

interface RejectedRankAdmission {
	readonly valid: false;
	readonly code: RankSearchRejectionCode.IncidentInfeasible;
}

type RankSearchRejection = RejectedDedicatedCandidate | RejectedRankAdmission;

export interface RankOrderSearchWitness {
	readonly mode: RankSearchMode;
	readonly stop: RankSearchStop;
	readonly proposed: number;
	readonly evaluated: number;
	readonly valid: number;
	readonly rejected: readonly {
		readonly order: RankOrder;
		readonly reason: RankSearchRejection;
	}[];
	readonly unverified: number;
	readonly prunedByLowerBound: number;
	readonly work: {
		readonly completePipelines: number;
		readonly validations: number;
		readonly routeRunsInspected: number;
	};
	readonly exhaustive: boolean;
	readonly truncated: boolean;
}

export interface ValidRankOrderCandidate {
	readonly order: RankOrder;
	readonly evaluation: DedicatedLayoutEvaluation;
	readonly routeScore: DedicatedRouteScore;
	readonly kendall: number;
	readonly documentary: boolean;
}

export interface RankOrderSearchInput {
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
	readonly measurements: LayoutMeasurements;
	readonly baseline: DedicatedLayoutEvaluation;
	readonly evaluate: (order: RankOrder) => DedicatedLayoutEvaluation;
	readonly limits: { readonly completePipelines: number; readonly uniqueProposals: number };
	readonly admit?: ((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
}

export interface RankOrderSearchResult {
	readonly selected: ValidRankOrderCandidate | undefined;
	readonly unchangedBaseline: DedicatedLayoutEvaluation;
	readonly witness: RankOrderSearchWitness;
}

function compareCandidates(left: ValidRankOrderCandidate, right: ValidRankOrderCandidate): number {
	const routeComparison = compareDedicatedRouteScores(left.routeScore, right.routeScore);
	if (routeComparison !== 0) return routeComparison;
	const distance = left.kendall - right.kendall;
	if (distance !== 0) return distance;
	// Only the documentary permutation has Kendall distance zero; the distance tie already
	// prefers it over every alternative before canonical IDs are compared.
	return compareRankOrders(left.order, right.order);
}

function zeroRoutes(candidate: ValidRankOrderCandidate): boolean {
	return candidate.routeScore.strictCrossings === 0 && candidate.routeScore.validatedBridges === 0;
}

function hasRelevantCrossing(
	input: RankOrderSearchInput,
	crossingIds: readonly (readonly string[])[],
): boolean {
	const { structure, domain } = input;
	const relevant = new Set(
		domain.locations.flatMap(
			({ componentIndex }) => defined(structure.components[componentIndex]).ids,
		),
	);
	const routes = new Map(structure.graph.relations.map(({ relation }) => [relation.id, relation]));
	return crossingIds.some((ids) =>
		ids.some((id) => {
			const relation = routes.get(id);
			return relevant.has(defined(relation).from) || relevant.has(defined(relation).to);
		}),
	);
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
	prunedByLowerBound = 0;
	readonly rejected: { order: RankOrder; reason: RankSearchRejection }[] = [];
	selected: ValidRankOrderCandidate | undefined;
	exhaustive = true;
	truncated = false;
	private readonly seen: Set<string>;
	private readonly frontier: RankOrder[];

	constructor(private readonly input: RankOrderSearchInput) {
		this.seen = new Set([JSON.stringify(input.domain.bands)]);
		this.frontier = [input.domain.bands];
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
				unverified: this.unverified,
				prunedByLowerBound: this.prunedByLowerBound,
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

	verify(order: RankOrder, evaluation: DedicatedLayoutEvaluation, documentary: boolean): void {
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
		if (this.input.admit !== undefined && !this.input.admit(evaluation.result, structure.ranks)) {
			this.rejected.push({
				order,
				reason: { valid: false, code: RankSearchRejectionCode.IncidentInfeasible },
			});
			return;
		}
		this.valid += 1;
		const candidate = {
			order,
			evaluation,
			routeScore: outcome.score,
			kendall: rankOrderKendallDistance(order, this.input.domain.bands),
			documentary,
		};
		if (this.selected === undefined || compareCandidates(candidate, this.selected) < 0)
			this.selected = candidate;
		if (!documentary) return;
		const crossingIds = outcome.analysis.crossings.map(({ horizontalId, verticalId }) => [
			horizontalId,
			verticalId,
		]);
		if (!hasRelevantCrossing(this.input, crossingIds)) {
			this.stop = RankSearchStop.NoRelevantCrossing;
			this.exhaustive = false;
		}
	}

	private cutOff(stop: RankSearchStop): false {
		this.stop = stop;
		this.truncated = true;
		this.exhaustive = false;
		return false;
	}

	private worseKendall(order: RankOrder, selected: ValidRankOrderCandidate): boolean {
		return rankOrderKendallDistance(order, this.input.domain.bands) > selected.kendall;
	}

	propose(order: RankOrder): boolean {
		const key = JSON.stringify(order);
		if (this.seen.has(key)) return true;
		if (this.proposed >= this.input.limits.uniqueProposals)
			return this.cutOff(RankSearchStop.ProposalBudget);
		this.seen.add(key);
		this.proposed += 1;
		this.frontier.push(order);
		const selected = this.selected;
		if (selected !== undefined && zeroRoutes(selected) && this.worseKendall(order, selected)) {
			this.prunedByLowerBound += 1;
			return true;
		}
		if (this.evaluated >= this.input.limits.completePipelines)
			return this.cutOff(RankSearchStop.EvaluationBudget);
		this.evaluated += 1;
		this.verify(order, this.input.evaluate(order), false);
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
			const best = defined(this.selected);
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
	if (input.domain.bands.length === 0) {
		search.unverified = 1;
		return search.result();
	}
	search.verify(input.domain.bands, input.baseline, true);
	const baseline = search.selected;
	if (baseline === undefined) {
		search.stop = RankSearchStop.BaselineRejected;
		search.exhaustive = false;
		return search.result();
	}
	if (zeroRoutes(baseline) && baseline.kendall === 0) {
		search.stop = RankSearchStop.OptimalBound;
		search.exhaustive = true;
		return search.result();
	}
	if (search.stop === RankSearchStop.NoRelevantCrossing) return search.result();
	if (boundedRankOrderEnumerationSize(input.domain, input.limits.completePipelines) !== undefined)
		search.runExact();
	else search.runHeuristic();
	return search.result();
}
