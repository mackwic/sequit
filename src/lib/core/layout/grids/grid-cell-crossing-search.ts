import { defined } from '../../document/logic-document';
import type { RegionGeometryDiagnostic } from '../geometry/region-geometry-diagnostic';
import { boundedCounter } from '../search/bounded-search';
import { CrossingAllocationPhaseId } from '../search/grid-cell-crossing-witness';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import { geometryKeyFromAllocation } from './grid-cell-crossing-identity';
import {
	type CrossingAllocationPhase,
	crossingAllocationPhases,
	crossingCanonicalBusGeometryCount,
	GRID_CROSSING_BRIDGE_BUDGET,
	GRID_CROSSING_EXTRA_TRACK_BUDGET,
	GRID_CROSSING_REALLOCATION_BUDGET,
	type GridCrossingAllocationBudgets,
	type GridCrossingAllocationSelectedWitness,
	type GridCrossingAllocationWitness,
} from './grid-cell-crossing-phases';

export interface GridCrossingRouteAttempt<Candidate> {
	readonly candidate: Candidate;
	readonly failure?: RegionGeometryDiagnostic;
}

interface GridCrossingAllocationSelection<Candidate> {
	readonly candidate: Candidate;
	readonly allocation: GridCrossingAllocation;
}

interface GridCrossingAllocationSearchSelected<Candidate> {
	readonly selected: GridCrossingAllocationSelection<Candidate>;
	readonly witness: GridCrossingAllocationSelectedWitness;
}

interface GridCrossingAllocationSearchFailed {
	readonly failure: RegionGeometryDiagnostic;
	readonly witness: GridCrossingAllocationWitness;
}

export type GridCrossingAllocationSearchResult<Candidate> =
	GridCrossingAllocationSearchSelected<Candidate> | GridCrossingAllocationSearchFailed;

interface GridCrossingAllocationPhaseResult<Candidate> {
	readonly selection: GridCrossingAllocationSelection<Candidate> | undefined;
	readonly failure: RegionGeometryDiagnostic | undefined;
	readonly rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][];
	readonly evidence: GridCrossingAllocationWitness['phases'][number];
}

function addConflictingRoutes(
	active: Set<string>,
	input: CrossingAllocationInput,
	failure: RegionGeometryDiagnostic,
): void {
	for (const id of [failure.relationId, failure.relatedRelationId])
		if (id !== undefined && input.crossingIds.includes(id)) active.add(id);
}

/** Rebuild the priority prefix when a rejection reveals a new route; then visit every remaining
 * allocation in canonical 1A order. This generator changes order, never the phase's space. */
function* orderedPhaseCandidates(
	phase: CrossingAllocationPhase,
	active: ReadonlySet<string>,
	conflictsFirst: boolean,
): Generator<GridCrossingAllocation, undefined, undefined> {
	if (conflictsFirst) {
		let known = active.size;
		let priority = phase.candidates(active, true);
		for (let next = priority.next(); next.done === false; next = priority.next()) {
			yield next.value;
			if (active.size !== known) {
				known = active.size;
				priority = phase.candidates(active, true);
			}
		}
	}
	yield* phase.candidates();
}

function searchGridCrossingPhase<Candidate>(
	input: CrossingAllocationInput,
	phase: CrossingAllocationPhase,
	frontier: { readonly active: Set<string>; readonly conflictsFirst: boolean },
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
): GridCrossingAllocationPhaseResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const explored = boundedCounter(phase.budget);
	const { active, conflictsFirst } = frontier;
	const total = phase.totalGeometries();
	const seen = new Set<string>();
	const busRelevant = new Set(input.busRelevantRelationIds);
	for (const allocation of orderedPhaseCandidates(phase, active, conflictsFirst)) {
		const key = geometryKeyFromAllocation(
			allocation.gutterTrackByRelationId,
			allocation.busTrackByRelationId,
			allocation.portTrackByEndpointId,
			busRelevant,
		);
		if (seen.has(key)) continue;
		if (!explored.take()) break;
		seen.add(key);
		const attempt = route(allocation, phase.acceptBridges);
		if (attempt.failure === undefined) {
			selection = { candidate: attempt.candidate, allocation };
			break;
		}
		failure = attempt.failure;
		rejectedAlternatives.push({
			phaseId: phase.id,
			busOrder: [...allocation.busTrackByRelationId]
				.sort((left, right) => left[1] - right[1])
				.map(([relationId]) => relationId),
			code: attempt.failure.code,
			reason: attempt.failure.message,
		});
		// Rejections enlarge the priority frontier; the canonical suffix still covers every
		// declared allocation, including routes that were never named by a diagnostic.
		addConflictingRoutes(active, input, attempt.failure);
		if (BigInt(explored.attempted) === total) break;
	}
	const exhaustive = BigInt(explored.attempted) === total;
	return {
		selection,
		failure,
		rejectedAlternatives,
		evidence: {
			id: phase.id,
			attempted: true,
			exploredGeometries: explored.attempted,
			totalGeometries: total.toString(),
			exhaustive,
			truncated: selection === undefined && !exhaustive,
			selected: selection !== undefined,
		},
	};
}

export enum GridCrossingSearchMode {
	Conflicts = 'conflicts',
	Exhaustive = 'exhaustive',
}

/** Search each declared grid issue with its own candidate budget and publish phase evidence. */
export function searchGridCrossingAllocations<Candidate>(
	input: CrossingAllocationInput,
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
	budgets?: GridCrossingAllocationBudgets,
	mode: GridCrossingSearchMode = GridCrossingSearchMode.Conflicts,
): GridCrossingAllocationSearchResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let winningPhase: CrossingAllocationPhase['id'] | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const phases = crossingAllocationPhases(input, budgets);
	const phaseEvidence: GridCrossingAllocationWitness['phases'][number][] = [];
	const active = new Set<string>();
	for (const phase of phases) {
		// If one bus order fits the phase budget, keep 1A's canonical precedence. Otherwise
		// front-load conflict permutations, then resume 1A's complete order without repeats.
		let extraTracks: 0 | 1 = 0;
		if (phase.id === CrossingAllocationPhaseId.ExtraTrack) extraTracks = 1;
		let standardBudget = GRID_CROSSING_REALLOCATION_BUDGET;
		if (phase.id === CrossingAllocationPhaseId.ExtraTrack)
			standardBudget = GRID_CROSSING_EXTRA_TRACK_BUDGET;
		if (phase.id === CrossingAllocationPhaseId.Bridge) standardBudget = GRID_CROSSING_BRIDGE_BUDGET;
		const priorityBudget = Math.min(phase.budget, standardBudget);
		const busBlockFits =
			crossingCanonicalBusGeometryCount(input, extraTracks) <= BigInt(priorityBudget);
		const result = searchGridCrossingPhase(
			input,
			phase,
			{ active, conflictsFirst: mode === GridCrossingSearchMode.Conflicts && !busBlockFits },
			route,
		);
		phaseEvidence.push(result.evidence);
		rejectedAlternatives.push(...result.rejectedAlternatives);
		if (result.failure !== undefined) failure = result.failure;
		if (result.selection === undefined) continue;
		selection = result.selection;
		winningPhase = phase.id;
		break;
	}
	for (const phase of phases.slice(phaseEvidence.length))
		phaseEvidence.push({
			id: phase.id,
			attempted: false,
			exploredGeometries: 0,
			totalGeometries: phase.totalGeometries().toString(),
			exhaustive: false,
			truncated: false,
			selected: false,
		});
	const witness: GridCrossingAllocationWitness = {
		attempted: phaseEvidence.reduce((sum, phase) => sum + phase.exploredGeometries, 0),
		exhaustive: phaseEvidence.every(({ attempted, exhaustive }) => attempted && exhaustive),
		rejectedAlternatives,
		phases: phaseEvidence,
	};
	if (selection !== undefined && winningPhase !== undefined)
		return { selected: selection, witness: { ...witness, winningPhase } };
	return { failure: defined(failure), witness };
}
