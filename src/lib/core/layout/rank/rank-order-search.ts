import { defined } from '../../document/logic-document';
import { compareDedicatedRouteScores } from '../dedicated-candidate-validation/route-score';
import {
	DedicatedCandidateRejectionCode,
	type DedicatedRouteScore,
	rejected,
	type RejectedDedicatedCandidate,
} from '../dedicated-candidate-validation/types';
import { validateDedicatedCandidate } from '../dedicated-candidate-validation/validate';
import {
	type DedicatedLayoutEvaluation,
	GroupRouteFailure,
	type LayoutMeasurements,
	type LayoutOptions,
	type LayoutResult,
} from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { ReopenedOrder } from './block-passage-repair';
import {
	boundedRankOrderEnumerationSize,
	lazyRankOrders,
	type RankOrder,
	rankOrderKendallDistance,
} from './rank-order';
import { adjacentOrders, BarycentricSweeper } from './rank-order-heuristic';
import { RankTopologyOracle } from './rank-order-topology';
import { applyRankOrder, type RankOrderDomain, repairBlockOrder } from './rank-ordering';

/** Alternating barycentric sweeps before local swaps. */
const MAX_SWEEPS = 4;

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
	readonly baseline: DedicatedLayoutEvaluation | GroupRouteFailure;
	readonly evaluate: (order: RankOrder) => DedicatedLayoutEvaluation;
	readonly admit?: ((layout: LayoutResult) => boolean) | undefined;
	readonly limits: { readonly completePipelines: number; readonly uniqueProposals: number };
}

export interface RankOrderSearchResult {
	readonly selected: ValidRankOrderCandidate | undefined;
	readonly unchangedBaseline: DedicatedLayoutEvaluation | GroupRouteFailure;
	readonly witness: RankOrderSearchWitness;
}

/**
 * No rank edit can improve bridge-free documentary routes, nor documentary rows already down
 * to the crossings every order keeps: a candidate must first cross less to win.
 */
function documentaryNeedsNoSearch(candidate: ValidRankOrderCandidate, lowerBound: number): boolean {
	if (candidate.routeScore.strictCrossings === 0 && candidate.routeScore.validatedBridges === 0)
		return true;
	return candidate.topologyCrossings <= lowerBound && candidate.kendall === 0;
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
	/** Block-repaired candidates already proposed: their reopened order was admitted once. */
	private readonly repaired = new Set<string>();
	private readonly frontier: RankOrder[];
	private readonly topology: RankTopologyOracle;
	readonly topologyBound: number;
	private readonly positions: readonly ReadonlyMap<string, number>[];
	private documentaryScore: DedicatedRouteScore | undefined;

	constructor(private readonly input: RankOrderSearchInput) {
		this.seen = new Set([JSON.stringify(input.domain.bands)]);
		this.frontier = [input.domain.bands];
		this.topology = new RankTopologyOracle(input.structure, input.domain);
		this.topologyBound = this.topology.lowerBound;
		this.positions = input.domain.bands.map(
			(band) => new Map(band.map((id, position) => [id, position])),
		);
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
		if (this.input.admit?.(evaluation.result) === false) {
			this.rejected.push({
				order,
				reason: rejected(DedicatedCandidateRejectionCode.IncidentAdmission),
			});
			return;
		}
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
		const { structure, domain } = this.input;
		const rows = applyRankOrder(structure, domain, order);
		const crossings = this.topology.crossings(rows, best.topologyCrossings);
		if (crossings !== best.topologyCrossings) return crossings > best.topologyCrossings;
		const kendall = rankOrderKendallDistance(order, this.input.domain.bands);
		if (kendall !== best.kendall) return kendall > best.kendall;
		return this.compareDocumentaryPositions(order, best.order) >= 0;
	}

	/** Ties prefer earlier documentary positions, so renaming an endpoint cannot change them. */
	private compareDocumentaryPositions(left: RankOrder, right: RankOrder): number {
		for (const [bandIndex, positions] of this.positions.entries())
			for (const [index, id] of defined(left[bandIndex]).entries()) {
				const other = defined(defined(right[bandIndex])[index]);
				const difference = defined(positions.get(id)) - defined(positions.get(other));
				if (difference !== 0) return difference;
			}
		return 0;
	}

	rejectGroupPassage(order: RankOrder, failure: GroupRouteFailure): void {
		this.validations += 1;
		this.rejected.push({
			order,
			reason: rejected(DedicatedCandidateRejectionCode.GroupPassage, undefined, failure.relationId),
		});
	}

	/**
	 * Sibling blocks keep one order, then every passage a wall closes is reopened if it can be.
	 * A candidate already met costs nothing: its reopened order was admitted the first time.
	 */
	propose(candidate: RankOrder): boolean {
		const order = repairBlockOrder(this.input.domain, candidate);
		const key = JSON.stringify(order);
		if (this.repaired.has(key)) return true;
		this.repaired.add(key);
		const reopened = this.topology.passages.reopen(order);
		if (reopened.order === order) return this.admit(reopened, key);
		return this.admit(reopened, JSON.stringify(reopened.order));
	}

	/** An order still closing a passage cannot be routed: it is neither evaluated nor explored. */
	private admit({ order, closed }: ReopenedOrder, key: string): boolean {
		if (this.seen.has(key)) return true;
		if (this.proposed >= this.input.limits.uniqueProposals)
			return this.cutOff(RankSearchStop.ProposalBudget);
		this.seen.add(key);
		this.proposed += 1;
		if (closed) return true;
		this.frontier.push(order);
		if (this.cannotBeatSelected(order)) return true;
		if (this.evaluated >= this.input.limits.completePipelines)
			return this.cutOff(RankSearchStop.EvaluationBudget);
		this.evaluated += 1;
		try {
			this.verify(order, this.input.evaluate(order));
		} catch (error) {
			if (!(error instanceof GroupRouteFailure)) throw error;
			this.rejectGroupPassage(order, error);
		}
		return true;
	}

	runExact(): void {
		this.mode = RankSearchMode.Exact;
		for (const order of lazyRankOrders(this.input.domain, this.input.domain.bands))
			if (!this.propose(order)) return;
		this.stop = RankSearchStop.Complete;
	}

	/**
	 * Sweeps alternate their direction until two in a row change nothing, within a few passes:
	 * bands coupled across containers need more than one round. The first sweep and the last one
	 * are proposed; the passes between only lead from one to the other.
	 */
	private sweeps(): boolean {
		const { domain } = this.input;
		const sweeper = new BarycentricSweeper(this.input);
		let current: ReopenedOrder = { order: domain.bands, closed: false };
		let key = JSON.stringify(current.order);
		let unchanged = 0;
		for (let pass = 0; pass < MAX_SWEEPS && unchanged < 2; pass += 1) {
			const sweep = sweeper.sweep(current.order, pass % 2 === 1);
			current = this.topology.passages.reopen(sweep);
			const previous = key;
			key = JSON.stringify(current.order);
			unchanged += 1;
			if (key !== previous) unchanged = 0;
			if (pass === 0 && !this.admit(current, key)) return false;
		}
		return this.admit(current, key);
	}

	runHeuristic(): void {
		this.mode = RankSearchMode.Heuristic;
		if (!this.sweeps()) return;
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
	if (input.baseline instanceof GroupRouteFailure)
		search.rejectGroupPassage(input.domain.bands, input.baseline);
	else search.verify(input.domain.bands, input.baseline, true);
	const documentary = search.selected;
	if (documentary !== undefined && documentaryNeedsNoSearch(documentary, search.topologyBound)) {
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
