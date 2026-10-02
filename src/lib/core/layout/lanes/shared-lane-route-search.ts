import { defined } from '../../document/logic-document';
import type { RouteWorkCharge } from '../bridges/route-runs';
import type {
	RegionIncidentContract,
	RegionIncidentSearchWitness,
	RegionSolvedIncident,
} from '../regions/model/region-incident-contract';
import { bestWithinBudgetStream } from '../search/bounded-search';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import { completedIncidentWitness, type IncidentSearchState } from './shared-lane-incident-search';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import {
	parallelCandidateTotal,
	type ParallelRouteCandidate,
	parallelRouteCandidates,
	parallelStrategyPlans,
	type SharedLaneAllocationSearchWitness,
} from './shared-lane-route-candidates';
import {
	laneRouteSelectionIsBetter,
	type RankedLaneRouteSelection,
	rankLaneRouteSelection,
} from './shared-lane-route-ranking';
import { type LaneRouteStrategy, twoPassStrategies } from './shared-lane-route-strategies';
import { TransverseRouteOrder } from './shared-transverse-routing';

/** Snapshot rejection provenance when an accepted geometry is ranked. */
export function laneSelectionCollector<Selection>(
	state: IncidentSearchState,
	contracts: readonly RegionIncidentContract[],
	collect:
		| ((
				selection: RankedLaneRouteSelection<Selection>,
				witness: RegionIncidentSearchWitness,
		  ) => void)
		| undefined,
): ((selection: RankedLaneRouteSelection<Selection>) => void) | undefined {
	if (collect === undefined) return undefined;
	return (selection) => {
		collect(selection, completedIncidentWitness(state, contracts));
	};
}

const MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS = 20_000;

/** Baselines are always evaluated; only alternatives share the fixed per-pass ceiling. */
class AllocationWorkExceeded extends Error {}

interface ParallelSelectionEvidence {
	readonly geometry: SharedLaneGeometry;
	readonly incidents: readonly RegionSolvedIncident[];
	readonly bridges?: number | undefined;
}

export interface ParallelRouteSearchResult<Selection> {
	readonly selected?: Selection;
	readonly allocationWitness: SharedLaneAllocationSearchWitness;
	readonly allocationTruncated: boolean;
}

interface ParallelRouteSearchInput<Selection extends ParallelSelectionEvidence> {
	readonly input: SharedLaneInput;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly state: IncidentSearchState;
	readonly evaluate: (
		candidate: ParallelRouteCandidate,
		acceptBridges: boolean,
		charge: RouteWorkCharge,
	) => Selection | undefined;
	/** Only candidate enumeration supplies this; production never materializes the accepted list. */
	readonly collect?: ((selection: RankedLaneRouteSelection<Selection>) => void) | undefined;
}

function rankEvaluatedCandidate<Selection extends ParallelSelectionEvidence>(
	candidate: ParallelRouteCandidate,
	acceptBridges: boolean,
	input: ParallelRouteSearchInput<Selection>,
	charge: RouteWorkCharge,
): RankedLaneRouteSelection<Selection> | undefined {
	input.state.strategyId = candidate.strategyId;
	input.state.candidateId = candidate.candidateId;
	const selected = input.evaluate(candidate, acceptBridges, charge);
	if (selected === undefined) return undefined;
	const ranked = rankLaneRouteSelection(selected, candidate, selected.bridges, charge);
	input.collect?.(ranked);
	return ranked;
}
function preferredCandidate<Selection>(
	best: RankedLaneRouteSelection<Selection> | undefined,
	ranked: RankedLaneRouteSelection<Selection> | undefined,
): RankedLaneRouteSelection<Selection> | undefined {
	if (ranked === undefined) return best;
	if (best === undefined || laneRouteSelectionIsBetter(ranked, best)) return ranked;
	return best;
}

function* baselineCandidates(
	candidates: Generator<ParallelRouteCandidate, undefined, void>,
	count: number,
): Generator<ParallelRouteCandidate, void, void> {
	let remaining = count;
	while (remaining > 0) {
		const candidate = defined(candidates.next().value);
		remaining -= 1;
		yield candidate;
	}
}

function bestBaselineSelection<Selection extends ParallelSelectionEvidence>(
	candidates: Iterable<ParallelRouteCandidate>,
	input: ParallelRouteSearchInput<Selection>,
	acceptBridges: boolean,
	charge: RouteWorkCharge,
): RankedLaneRouteSelection<Selection> | undefined {
	let best: RankedLaneRouteSelection<Selection> | undefined;
	for (const candidate of candidates) {
		charge(input.input.plans.length * 10);
		const ranked = rankEvaluatedCandidate(candidate, acceptBridges, input, charge);
		if (ranked === undefined) continue;
		if (best === undefined || laneRouteSelectionIsBetter(ranked, best)) best = ranked;
	}
	return best;
}

function laneRouteSelectionMeetsLowerBound<Selection extends ParallelSelectionEvidence>(
	ranked: RankedLaneRouteSelection<Selection>,
): boolean {
	if (ranked.bridges !== 0) return false;
	const pathLowerBound = (
		points: readonly { readonly x: number; readonly y: number }[],
	): { readonly length: number; readonly bends: number } => {
		const first = defined(points[0]);
		const last = defined(points[points.length - 1]);
		const horizontalLength = Math.abs(last.x - first.x);
		const verticalLength = Math.abs(last.y - first.y);
		let bends = 1;
		if (first.x === last.x || first.y === last.y) bends = 0;
		return { length: horizontalLength + verticalLength, bends };
	};
	let minimumLength = 0;
	let minimumBends = 0;
	for (const route of ranked.selected.geometry.relations) {
		const lowerBound = pathLowerBound(route.points);
		minimumLength += lowerBound.length;
		minimumBends += lowerBound.bends;
	}
	return ranked.length === minimumLength && ranked.bends === minimumBends;
}

function laneSearchCanStop<Selection extends ParallelSelectionEvidence>(
	contracts: readonly RegionIncidentContract[],
	ranked: RankedLaneRouteSelection<Selection> | undefined,
): boolean {
	if (contracts.length > 0 || ranked === undefined) return false;
	return laneRouteSelectionMeetsLowerBound(ranked);
}

interface AlternativeSearch<Selection> {
	readonly best: RankedLaneRouteSelection<Selection> | undefined;
	readonly attempted: number;
	readonly work: number;
}

function evaluateAlternatives<Selection extends ParallelSelectionEvidence>(
	candidates: Generator<ParallelRouteCandidate, undefined, void>,
	input: ParallelRouteSearchInput<Selection>,
	acceptBridges: boolean,
	baseline: RankedLaneRouteSelection<Selection> | undefined,
): AlternativeSearch<Selection> {
	let best = baseline;
	let work = 0;
	let attempted = 0;
	const charge: RouteWorkCharge = (units) => {
		if (work + units > MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS) throw new AllocationWorkExceeded();
		work += units;
	};
	const generationWork = Math.max(1, input.input.plans.length * 10);
	while (work + generationWork <= MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS) {
		const next = candidates.next();
		if (next.done === true) break;
		try {
			charge(generationWork);
			const ranked = rankEvaluatedCandidate(next.value, acceptBridges, input, charge);
			attempted += 1;
			best = preferredCandidate(best, ranked);
		} catch (error) {
			if (!(error instanceof AllocationWorkExceeded)) throw error;
			return { best, attempted, work };
		}
	}
	return { best, attempted, work };
}

export function searchParallelRouteAllocations<Selection extends ParallelSelectionEvidence>(
	input: ParallelRouteSearchInput<Selection>,
): ParallelRouteSearchResult<Selection> {
	const { input: lanes, ports, contracts } = input;
	const plans = parallelStrategyPlans(lanes, ports, contracts);
	const total = parallelCandidateTotal(plans);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
	const workBudget = MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS;
	let allocationTruncated = false;
	let firstSelected: Selection | undefined;
	for (const acceptBridges of [false, true]) {
		const candidates = parallelRouteCandidates(plans, acceptBridges);
		const baselineCount = plans.length;
		const attempted = baselineCount;
		let baselineWork = 0;
		const chargeBaseline: RouteWorkCharge = (units) => {
			baselineWork += units;
		};
		const best = bestBaselineSelection(
			baselineCandidates(candidates, baselineCount),
			input,
			acceptBridges,
			chargeBaseline,
		);
		const stopsAtBaseline = input.collect === undefined && laneSearchCanStop(contracts, best);
		if (best !== undefined && stopsAtBaseline) {
			const exhaustive = BigInt(attempted) === BigInt(total);
			passes.push({
				acceptBridges,
				attempted,
				total,
				exhaustive,
				truncated: false,
				searchStarted: false,
				work: 0,
				baselineWork,
				workBudget,
			});
			return { selected: best.selected, allocationWitness: { passes }, allocationTruncated };
		}
		const alternatives = evaluateAlternatives(candidates, input, acceptBridges, best);
		const completed = attempted + alternatives.attempted;
		const exhaustive = BigInt(completed) === BigInt(total);
		const truncated = !exhaustive;
		passes.push({
			acceptBridges,
			attempted: completed,
			total,
			exhaustive,
			truncated,
			searchStarted: true,
			work: alternatives.work,
			baselineWork,
			workBudget,
		});
		allocationTruncated ||= truncated;
		if (alternatives.best !== undefined) {
			firstSelected ??= alternatives.best.selected;
			if (input.collect === undefined)
				return {
					selected: firstSelected,
					allocationWitness: { passes },
					allocationTruncated,
				};
		}
	}
	if (firstSelected === undefined) return { allocationWitness: { passes }, allocationTruncated };
	return { selected: firstSelected, allocationWitness: { passes }, allocationTruncated };
}
export interface TransverseRouteSearchResult<Selection> {
	readonly selected?: Selection;
	readonly allocationWitness: SharedLaneAllocationSearchWitness;
}

interface TransverseRouteSearchInput<Selection extends ParallelSelectionEvidence> {
	readonly evaluate: (strategy: LaneRouteStrategy<TransverseRouteOrder>) => Selection | undefined;
	readonly collect?: ((selection: RankedLaneRouteSelection<Selection>) => void) | undefined;
}

export function searchTransverseRouteOrders<Selection extends ParallelSelectionEvidence>(
	input: TransverseRouteSearchInput<Selection>,
): TransverseRouteSearchResult<Selection> {
	const strategies = twoPassStrategies('transverse', [
		TransverseRouteOrder.Canonical,
		TransverseRouteOrder.Nested,
	]);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
	let firstSelected: Selection | undefined;
	for (const acceptBridges of [false, true]) {
		const alternatives = strategies.filter((strategy) => strategy.acceptBridges === acceptBridges);
		const pass = bestWithinBudgetStream({
			alternatives,
			budget: alternatives.length,
			total: String(alternatives.length),
			evaluate: (strategy): RankedLaneRouteSelection<Selection> | undefined => {
				const selected = input.evaluate(strategy);
				if (selected === undefined) return undefined;
				let historicalRank = 1;
				if (strategy.order === TransverseRouteOrder.Canonical) historicalRank = 0;
				const ranked = rankLaneRouteSelection(selected, {
					historicalRank,
					allocationKey: '[]',
					strategyId: strategy.id,
					candidateId: strategy.order,
				});
				input.collect?.(ranked);
				return ranked;
			},
			better: laneRouteSelectionIsBetter,
		});
		passes.push({
			acceptBridges,
			attempted: pass.attempted,
			total: pass.total,
			exhaustive: pass.exhaustive,
			truncated: pass.truncated,
			searchStarted: true,
			work: pass.attempted,
			workBudget: alternatives.length,
		});
		if (pass.incumbent !== undefined) {
			firstSelected ??= pass.incumbent.selected;
			if (input.collect === undefined)
				return { selected: firstSelected, allocationWitness: { passes } };
		}
	}
	if (firstSelected === undefined) return { allocationWitness: { passes } };
	return { selected: firstSelected, allocationWitness: { passes } };
}
