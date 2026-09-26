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

const MAX_SHARED_LANE_ALLOCATION_CANDIDATES_PER_PASS = 64;

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
	for (const incident of ranked.selected.incidents) {
		const lowerBound = pathLowerBound(incident.points);
		minimumLength += lowerBound.length;
		minimumBends += lowerBound.bends;
	}
	return ranked.length === minimumLength && ranked.bends === minimumBends;
}

export function searchParallelRouteAllocations<Selection extends ParallelSelectionEvidence>(
	input: ParallelRouteSearchInput<Selection>,
): ParallelRouteSearchResult<Selection> {
	const { input: lanes, ports, contracts, state, evaluate } = input;
	const plans = parallelStrategyPlans(lanes, ports, contracts);
	const total = parallelCandidateTotal(plans);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
	let allocationTruncated = false;
	for (const acceptBridges of [false, true]) {
		const candidates = parallelRouteCandidates(lanes, plans, acceptBridges);
		const attempted = plans.length;
		let best = bestBaselineSelection(
			baselineCandidates(candidates, attempted),
			input,
			acceptBridges,
		);
		if (best !== undefined && laneRouteSelectionMeetsLowerBound(best)) {
			const exhaustive = BigInt(attempted) === BigInt(total);
			passes.push({
				acceptBridges,
				attempted,
				total,
				exhaustive,
				truncated: false,
				searchStarted: false,
			});
			return {
				selected: best.selected,
				allocationWitness: { passes },
				allocationTruncated,
			};
		}
		const pass = bestWithinBudgetStream({
			alternatives: candidates,
			budget: Math.max(0, MAX_SHARED_LANE_ALLOCATION_CANDIDATES_PER_PASS - attempted),
			total,
			evaluate: (candidate): RankedLaneRouteSelection<Selection> | undefined => {
				const ranked = rankEvaluatedCandidate(candidate, acceptBridges, state, evaluate);
				if (ranked === undefined) return undefined;
				if (best === undefined || laneRouteSelectionIsBetter(ranked, best)) best = ranked;
				return best;
			},
			better: laneRouteSelectionIsBetter,
		});
		passes.push({
			acceptBridges,
			attempted: attempted + pass.attempted,
			total: pass.total,
			exhaustive: pass.exhaustive,
			truncated: pass.truncated,
			searchStarted: true,
		});
		allocationTruncated ||= pass.truncated;
		if (best !== undefined)
			return {
				selected: best.selected,
				allocationWitness: { passes },
				allocationTruncated,
			};
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
		});
		if (pass.incumbent !== undefined)
			return { selected: pass.incumbent.selected, allocationWitness: { passes } };
	}
	return { allocationWitness: { passes } };
}
