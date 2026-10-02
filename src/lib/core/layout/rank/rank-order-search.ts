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
	type DedicatedCandidateFailure,
	type DedicatedLayoutEvaluation,
	GroupRouteFailure,
	isDedicatedCandidateFailure,
	type LayoutMeasurements,
	type LayoutOptions,
	type LayoutResult,
} from '../layout-types';
import type { LayoutStructure } from '../structure/prepare-layout';
import type { ReopenedOrder } from './block-passage-repair';
import {
	boundedRankOrderEnumerationSize,
	enumerateRankOrders,
	type RankOrder,
	rankOrderKendallDistance,
} from './rank-order';
import { adjacentOrders, BarycentricSweeper } from './rank-order-heuristic';
import { RankTopologyOracle } from './rank-order-topology';
import { type RankOrderSearchWitness, RankSearchMode, RankSearchStop } from './rank-order-witness';
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
	readonly baseline: DedicatedLayoutEvaluation | DedicatedCandidateFailure;
	/** A rejection the caller already validated on the same document; the baseline is not judged again. */
	readonly documentaryRejection?: RejectedDedicatedCandidate | undefined;
	readonly evaluate: (order: RankOrder) => DedicatedLayoutEvaluation;
	readonly admit?: ((layout: LayoutResult) => boolean) | undefined;
	readonly limits: { readonly completePipelines: number; readonly uniqueProposals: number };
}

export interface RankOrderSearchResult {
	readonly selected: ValidRankOrderCandidate | undefined;
	readonly unchangedBaseline: DedicatedLayoutEvaluation | DedicatedCandidateFailure;
	readonly witness: RankOrderSearchWitness;
}

/** The typed verdict on a candidate whose geometry could not be built. */
export function failureRejection(failure: DedicatedCandidateFailure): RejectedDedicatedCandidate {
	if (failure instanceof GroupRouteFailure)
		return rejected(DedicatedCandidateRejectionCode.GroupPassage, undefined, failure.relationId);
	return {
		...rejected(DedicatedCandidateRejectionCode.ElementOverlap, failure.from, failure.relationId),
		otherEndpointId: failure.to,
	};
}

function crossingFree(candidate: ValidRankOrderCandidate): boolean {
	return candidate.routeScore.strictCrossings === 0 && candidate.routeScore.validatedBridges === 0;
}

class RankOrderSearch {
	mode = RankSearchMode.Skipped;
	stop = RankSearchStop.NoBand;
	proposed = 1;
	evaluated = 1;
	/** Routable proposals met once the pipeline budget was spent: never scored on real routes. */
	pruned = 0;
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
	/** Heuristic proposals the proxy ranks behind the best order, routed once the walk is over. */
	private readonly deferred: RankOrder[] = [];
	private readonly topology: RankTopologyOracle;
	private readonly positions: readonly ReadonlyMap<string, number>[];
	private documentaryScore: DedicatedRouteScore | undefined;

	constructor(private readonly input: RankOrderSearchInput) {
		this.seen = new Set([JSON.stringify(input.domain.bands)]);
		this.frontier = [input.domain.bands];
		this.topology = new RankTopologyOracle(input.structure, input.domain);
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
				pruned: this.pruned,
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
		// Real routes rank first: the topological proxy and the documentary distance only break
		// ties between equal route scores, so an order the proxy dislikes still wins by crossing less.
		const best = this.selected;
		if (best === undefined) {
			this.selected = candidate;
			return;
		}
		const routes = compareDedicatedRouteScores(candidate.routeScore, best.routeScore);
		const topology = candidate.topologyCrossings - best.topologyCrossings;
		const kendall = candidate.kendall - best.kendall;
		const rank =
			routes || topology || kendall || this.compareDocumentaryPositions(order, best.order);
		if (rank < 0) this.selected = candidate;
	}

	/** The first budget reached names the stop; a later one cannot hide it. */
	private truncate(stop: RankSearchStop): void {
		if (!this.truncated) this.stop = stop;
		this.truncated = true;
		this.exhaustive = false;
	}

	private end(stop: RankSearchStop): false {
		this.stop = stop;
		this.exhaustive = false;
		return false;
	}

	/**
	 * The proxy ranks this order behind the best one: its pipeline may wait, since a heuristic walk
	 * can propose more orders than its budget routes.
	 */
	private cannotBeatSelected(order: RankOrder): boolean {
		const best = this.selected;
		if (best === undefined) return false;
		const { structure, domain } = this.input;
		const rows = applyRankOrder(structure, domain, order);
		const crossings = this.topology.crossings(rows, best.topologyCrossings);
		if (crossings !== best.topologyCrossings) return crossings > best.topologyCrossings;
		const kendall = rankOrderKendallDistance(order, domain.bands);
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

	/** A candidate that could not be built is rejected without any validation call. */
	rejectFailure(order: RankOrder, failure: DedicatedCandidateFailure): void {
		this.rejected.push({ order, reason: failureRejection(failure) });
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

	/**
	 * An order still closing a passage cannot be routed: it is neither evaluated nor explored.
	 * Every other proposal is routed, a heuristic one the proxy ranks behind the best order only
	 * after the walk; none is discarded on the proxy alone.
	 */
	private admit({ order, closed }: ReopenedOrder, key: string): boolean {
		if (this.seen.has(key)) return true;
		if (this.proposed >= this.input.limits.uniqueProposals) {
			this.truncate(RankSearchStop.ProposalBudget);
			return false;
		}
		this.seen.add(key);
		this.proposed += 1;
		if (closed) return true;
		this.frontier.push(order);
		if (this.mode === RankSearchMode.Heuristic && this.cannotBeatSelected(order)) {
			this.deferred.push(order);
			return true;
		}
		return this.route(order);
	}

	/**
	 * Scores one proposal on real routes while pipelines remain; later ones are counted as pruned.
	 * Routes without crossing or bridge end the search, even if a closer order would route so too.
	 */
	private route(order: RankOrder): boolean {
		if (this.evaluated >= this.input.limits.completePipelines) {
			this.pruned += 1;
			this.truncate(RankSearchStop.EvaluationBudget);
			return true;
		}
		this.evaluated += 1;
		try {
			this.verify(order, this.input.evaluate(order));
		} catch (error) {
			if (!isDedicatedCandidateFailure(error)) throw error;
			this.rejectFailure(order, error);
		}
		if (this.selected !== undefined && crossingFree(this.selected))
			return this.end(RankSearchStop.CrossingFree);
		return true;
	}

	/**
	 * Every enumerated order fits the pipeline budget, so none waits on the proxy. Orders closer
	 * to the documentary one are met first: the first crossing-free order met is the closest one.
	 */
	runExact(): void {
		this.mode = RankSearchMode.Exact;
		const { bands } = this.input.domain;
		const orders = enumerateRankOrders(this.input.domain, this.input.limits.completePipelines)
			.map((order) => ({ order, kendall: rankOrderKendallDistance(order, bands) }))
			.toSorted((left, right) => left.kendall - right.kendall);
		for (const { order } of orders) if (!this.propose(order)) return;
		if (!this.truncated) this.stop = RankSearchStop.Complete;
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

	/** The walk routes the orders the proxy promises first; the deferred ones take what is left. */
	runHeuristic(): void {
		this.mode = RankSearchMode.Heuristic;
		this.walk();
		if (this.stop === RankSearchStop.CrossingFree) return;
		for (const order of this.deferred) if (!this.route(order)) return;
	}

	private walk(): void {
		if (!this.sweeps() || !this.localImprovements()) return;
		for (const source of this.frontier)
			for (const order of adjacentOrders(source)) if (!this.propose(order)) return;
		if (!this.truncated) this.stop = RankSearchStop.Complete;
	}

	/** False once the search has ended. */
	private localImprovements(): boolean {
		let changed = true;
		while (changed) {
			changed = false;
			const best = this.selected;
			if (best === undefined) return true;
			for (const order of adjacentOrders(best.order)) {
				if (!this.propose(order)) return false;
				if (this.selected !== best) changed = true;
			}
		}
		return true;
	}
}

/** Scores only complete, independently validated LayoutResults; the baseline is never rerun. */
export function searchDedicatedRankOrders(input: RankOrderSearchInput): RankOrderSearchResult {
	const search = new RankOrderSearch(input);
	const { baseline, documentaryRejection } = input;
	if (documentaryRejection !== undefined)
		search.rejected.push({ order: input.domain.bands, reason: documentaryRejection });
	else if (isDedicatedCandidateFailure(baseline))
		search.rejectFailure(input.domain.bands, baseline);
	else search.verify(input.domain.bands, baseline, true);
	const documentary = search.selected;
	if (documentary !== undefined && crossingFree(documentary)) {
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
