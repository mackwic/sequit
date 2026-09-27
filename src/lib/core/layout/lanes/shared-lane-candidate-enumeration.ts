import { defined, LaneOrientation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { LayoutMeasurements } from '../layout-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	type RegionIncidentRejectedAlternative,
	type RegionIncidentSearchWitness,
	type RegionSolvedIncident,
} from '../regions/model/region-incident-contract';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import {
	completedIncidentWitness,
	enumerateLaneIncidentPaths,
	type IncidentSearchState,
} from './shared-lane-incident-search';
import {
	type LaneAttemptInput,
	parallelAttempt,
	selectedLayout,
	type SelectedSharedLaneLayout,
	type SharedLaneAttempt,
	SharedLaneLayoutStatus,
	type SharedLaneSolveOptions,
	solveSharedLaneLayout,
	transverseAttempt,
} from './shared-lane-layout';
import { prepareSharedLanes } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneAllocationSearchWitness } from './shared-lane-route-candidates';
import {
	type LaneCandidate,
	laneRouteSelectionIsBetter,
	type RankedLaneRouteSelection,
} from './shared-lane-route-ranking';

interface RejectedLaneAllocation {
	readonly strategyId: string;
	readonly candidateId: string;
	readonly reason: string;
}

export interface LaneCandidateSearchWitness extends RegionIncidentSearchWitness {
	readonly allocationWitness: SharedLaneAllocationSearchWitness | undefined;
	readonly rejectedAllocations: readonly RejectedLaneAllocation[];
}

interface CandidateEvidence {
	attempted: number;
	exhaustive: boolean;
	readonly rejectedAlternatives: RegionIncidentRejectedAlternative[];
}

function candidateKey(
	geometry: SharedLaneGeometry,
	incidents: readonly RegionSolvedIncident[],
): string {
	return JSON.stringify([geometry, incidents]);
}

/** The allocation search already evaluated its first route; subsequent incident alternatives are
 * evaluated only when the consumer advances the stream. Each geometry gets a 256-choice cap. */
function* routesForCandidate(input: {
	readonly ranked: RankedLaneRouteSelection<LaneCandidate>;
	readonly witness: RegionIncidentSearchWitness;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly evidence: CandidateEvidence;
}): Generator<{
	readonly incidents: readonly RegionSolvedIncident[];
	readonly witness: RegionIncidentSearchWitness;
}> {
	const { ranked, witness, ports, contracts, evidence } = input;
	yield { incidents: ranked.selected.incidents, witness };
	if (contracts.length === 0) return;
	const state: IncidentSearchState = {
		attempted: 0,
		exhaustive: true,
		strategyId: ranked.candidate.strategyId,
		candidateId: ranked.candidate.candidateId,
		rejectedAlternatives: [],
	};
	for (const incidents of enumerateLaneIncidentPaths({
		geometry: ranked.selected.geometry,
		ports,
		contracts,
		state,
	}))
		yield { incidents, witness: completedIncidentWitness(state, contracts) };
	evidence.attempted += state.attempted;
	evidence.exhaustive &&= state.exhaustive;
	evidence.rejectedAlternatives.push(...state.rejectedAlternatives);
}

/** First pull is exactly the production selection, including its cache-independent witness.
 * Allocation and incident alternatives are then enumerated under their existing separate budgets.
 * The terminal result is the accumulated bounded incident witness; allocation work is on each
 * yielded candidate's allocationWitness. The stream does not compose or select a new layout. */
export function* enumerateSharedLaneLayouts(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: SharedLaneSolveOptions = {},
): Generator<SelectedSharedLaneLayout, LaneCandidateSearchWitness, void> {
	const first = solveSharedLaneLayout(graph, ranks, measurements, options);
	if (first.status === SharedLaneLayoutStatus.Unknown)
		return {
			...first.witness,
			allocationWitness: first.allocationWitness,
			rejectedAllocations: [],
		};
	if (first.status === SharedLaneLayoutStatus.Unsupported)
		return {
			attempted: 0,
			exhaustive: true,
			rejectedAlternatives: [],
			allocationWitness: undefined,
			rejectedAllocations: [],
		};
	yield first;
	const contracts = normalizeRegionIncidentContracts(options.incidents ?? []);
	const prepared = prepareSharedLanes(graph, ranks, measurements, options);
	const input = defined(prepared.input);
	const ports = planSharedLanePorts(input, contracts);
	const collected: {
		readonly ranked: RankedLaneRouteSelection<LaneCandidate>;
		readonly witness: RegionIncidentSearchWitness;
	}[] = [];
	const collect: NonNullable<LaneAttemptInput['collect']> = (ranked, witness) => {
		collected.push({ ranked, witness });
	};
	const rejectedAllocations: RejectedLaneAllocation[] = [];
	const onAllocationReject: NonNullable<LaneAttemptInput['onAllocationReject']> = (
		strategyId,
		candidateId,
		reason,
	) => {
		rejectedAllocations.push({ strategyId, candidateId, reason });
	};
	let replayIncidentExhaustive = true;
	const onSearchCompleted: NonNullable<LaneAttemptInput['onSearchCompleted']> = (witness) => {
		replayIncidentExhaustive &&= witness.exhaustive;
	};
	const attempt = {
		graph,
		input,
		ports,
		contracts,
		collect,
		onAllocationReject,
		onSearchCompleted,
	};
	let replay: SharedLaneAttempt;
	if (input.orientation === LaneOrientation.Parallel) replay = parallelAttempt(attempt);
	else replay = transverseAttempt(attempt);
	collected.sort((left, right) => {
		if (laneRouteSelectionIsBetter(left.ranked, right.ranked)) return -1;
		if (laneRouteSelectionIsBetter(right.ranked, left.ranked)) return 1;
		return 0;
	});
	const seen = new Set([candidateKey(first.geometry, first.incidents)]);
	const evidence: CandidateEvidence = {
		attempted: replay.witness.attempted,
		exhaustive: replayIncidentExhaustive,
		rejectedAlternatives: [...replay.witness.rejectedAlternatives],
	};
	for (const { ranked, witness } of collected) {
		const geometry = ranked.selected.geometry;
		for (const candidate of routesForCandidate({ ranked, witness, ports, contracts, evidence })) {
			const key = candidateKey(geometry, candidate.incidents);
			if (seen.has(key)) continue;
			seen.add(key);
			yield selectedLayout(
				geometry,
				candidate.incidents,
				candidate.witness,
				replay.allocationWitness,
			);
		}
	}
	let allocationsExhaustive = true;
	if (replay.allocationWitness !== undefined)
		allocationsExhaustive = replay.allocationWitness.passes.every((pass) => pass.exhaustive);
	return {
		...evidence,
		exhaustive: evidence.exhaustive && allocationsExhaustive,
		allocationWitness: replay.allocationWitness,
		rejectedAllocations,
	};
}
