import { defined } from '../document/logic-document';
import { bestWithinBudgetStream } from './bounded-search';
import type { RegionIncidentContract, RegionSolvedIncident } from './region-incident-contract';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import type { IncidentSearchState } from './shared-lane-incident-search';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import {
	laneRouteSelectionIsBetter,
	parallelCandidateTotal,
	type ParallelRouteCandidate,
	parallelRouteCandidates,
	parallelStrategyPlans,
	type RankedLaneRouteSelection,
	rankLaneRouteSelection,
	type SharedLaneAllocationSearchWitness,
} from './shared-lane-route-candidates';
import { type LaneRouteStrategy, twoPassStrategies } from './shared-lane-route-strategies';
import { TransverseRouteOrder } from './shared-transverse-routing';

const MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS = 20_000;

/** Bound the route-segment/box and pairwise contact probes before evaluating an allocation. */
function parallelCandidateWork(input: SharedLaneInput, elementCount: number): number {
	const routes = input.plans.length;
	const boxProbes = routes * 5 * elementCount;
	const routePairs = (routes * (routes - 1)) / 2;
	const contactProbes = routePairs * 25;
	const routeWork = boxProbes + contactProbes;
	return Math.max(1, routeWork + routes * 10);
}

interface ParallelSelectionEvidence {
	readonly geometry: SharedLaneGeometry;
	readonly incidents: readonly RegionSolvedIncident[];
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
	) => Selection | undefined;
}

function rankEvaluatedCandidate<Selection extends ParallelSelectionEvidence>(
	candidate: ParallelRouteCandidate,
	acceptBridges: boolean,
	state: IncidentSearchState,
	evaluate: ParallelRouteSearchInput<Selection>['evaluate'],
): RankedLaneRouteSelection<Selection> | undefined {
	state.strategyId = candidate.strategyId;
	state.candidateId = candidate.candidateId;
	const selected = evaluate(candidate, acceptBridges);
	if (selected === undefined) return undefined;
	return rankLaneRouteSelection(selected, candidate);
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
): RankedLaneRouteSelection<Selection> | undefined {
	let best: RankedLaneRouteSelection<Selection> | undefined;
	for (const candidate of candidates) {
		const ranked = rankEvaluatedCandidate(candidate, acceptBridges, input.state, input.evaluate);
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

export function searchParallelRouteAllocations<Selection extends ParallelSelectionEvidence>(
	input: ParallelRouteSearchInput<Selection>,
): ParallelRouteSearchResult<Selection> {
	const { input: lanes, ports, contracts, state, evaluate } = input;
	const plans = parallelStrategyPlans(lanes, ports, contracts);
	const total = parallelCandidateTotal(plans);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
	const candidateWork = parallelCandidateWork(lanes, defined(plans[0]).frame.elements.length);
	const workBudget = Math.max(
		MAX_SHARED_LANE_ALLOCATION_WORK_PER_PASS,
		plans.length * candidateWork,
	);
	let allocationTruncated = false;
	for (const acceptBridges of [false, true]) {
		const candidates = parallelRouteCandidates(lanes, plans, acceptBridges);
		const baselineCount = plans.length;
		let attempted = baselineCount;
		let work = baselineCount * candidateWork;
		let best = bestBaselineSelection(
			baselineCandidates(candidates, baselineCount),
			input,
			acceptBridges,
		);
		if (best !== undefined && laneSearchCanStop(contracts, best)) {
			const exhaustive = BigInt(attempted) === BigInt(total);
			passes.push({
				acceptBridges,
				attempted,
				total,
				exhaustive,
				truncated: false,
				searchStarted: false,
				work,
				workBudget,
			});
			return { selected: best.selected, allocationWitness: { passes }, allocationTruncated };
		}
		while (work + candidateWork <= workBudget) {
			const next = candidates.next();
			if (next.done === true) break;
			attempted += 1;
			work += candidateWork;
			const ranked = rankEvaluatedCandidate(next.value, acceptBridges, state, evaluate);
			best = preferredCandidate(best, ranked);
		}
		const exhaustive = BigInt(attempted) === BigInt(total);
		const truncated = !exhaustive;
		passes.push({
			acceptBridges,
			attempted,
			total,
			exhaustive,
			truncated,
			searchStarted: true,
			work,
			workBudget,
		});
		allocationTruncated ||= truncated;
		if (best !== undefined)
			return { selected: best.selected, allocationWitness: { passes }, allocationTruncated };
	}
	return { allocationWitness: { passes }, allocationTruncated };
}
export interface TransverseRouteSearchResult<Selection> {
	readonly selected?: Selection;
	readonly allocationWitness: SharedLaneAllocationSearchWitness;
}

interface TransverseRouteSearchInput<Selection extends ParallelSelectionEvidence> {
	readonly evaluate: (strategy: LaneRouteStrategy<TransverseRouteOrder>) => Selection | undefined;
}

export function searchTransverseRouteOrders<Selection extends ParallelSelectionEvidence>(
	input: TransverseRouteSearchInput<Selection>,
): TransverseRouteSearchResult<Selection> {
	const strategies = twoPassStrategies('transverse', [
		TransverseRouteOrder.Canonical,
		TransverseRouteOrder.Nested,
	]);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
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
				return rankLaneRouteSelection(selected, {
					historicalRank,
					allocationKey: '[]',
					strategyId: strategy.id,
					candidateId: strategy.order,
				});
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
		if (pass.incumbent !== undefined)
			return { selected: pass.incumbent.selected, allocationWitness: { passes } };
	}
	return { allocationWitness: { passes } };
}
