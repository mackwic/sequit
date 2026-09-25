import { bestWithinBudgetStream } from './bounded-search';
import type { RegionIncidentContract, RegionSolvedIncident } from './region-incident-contract';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import type { IncidentSearchState } from './shared-lane-incident-search';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import {
	parallelCandidateTotal,
	type ParallelRouteCandidate,
	parallelRouteCandidates,
	parallelSelectionIsBetter,
	parallelStrategyPlans,
	type RankedParallelSelection,
	rankParallelSelection,
	type SharedLaneAllocationSearchWitness,
} from './shared-lane-route-candidates';

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

export function searchParallelRouteAllocations<Selection extends ParallelSelectionEvidence>(
	input: ParallelRouteSearchInput<Selection>,
): ParallelRouteSearchResult<Selection> {
	const { input: lanes, ports, contracts, state, evaluate } = input;
	const plans = parallelStrategyPlans(lanes, ports, contracts);
	const passes: SharedLaneAllocationSearchWitness['passes'][number][] = [];
	for (const acceptBridges of [false, true]) {
		const pass = bestWithinBudgetStream({
			alternatives: parallelRouteCandidates(lanes, plans, acceptBridges),
			budget: MAX_SHARED_LANE_ALLOCATION_CANDIDATES_PER_PASS,
			total: parallelCandidateTotal(plans),
			evaluate: (candidate): RankedParallelSelection<Selection> | undefined => {
				state.strategyId = candidate.strategyId;
				state.candidateId = candidate.candidateId;
				const selected = evaluate(candidate, acceptBridges);
				if (selected === undefined) return undefined;
				return rankParallelSelection(selected, candidate);
			},
			better: parallelSelectionIsBetter,
		});
		passes.push({
			acceptBridges,
			attempted: pass.attempted,
			total: pass.total,
			exhaustive: pass.exhaustive,
			truncated: pass.truncated,
		});
		const allocationWitness: SharedLaneAllocationSearchWitness = { passes };
		if (pass.incumbent !== undefined)
			return { selected: pass.incumbent.selected, allocationWitness, allocationTruncated: false };
		if (!pass.exhaustive || !state.exhaustive)
			return { allocationWitness, allocationTruncated: !pass.exhaustive };
	}
	return { allocationWitness: { passes }, allocationTruncated: false };
}
