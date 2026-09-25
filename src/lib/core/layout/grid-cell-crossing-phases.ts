import { defined } from '../document/logic-document';
import type { BoundedSearchWitness } from './bounded-search';
import {
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';

/** Maximum allocations examined while permuting the existing gutter, bus, and port tracks. */
export const GRID_CROSSING_REALLOCATION_BUDGET = 256;
/** Maximum allocations examined after adding one reserved gutter track. */
export const GRID_CROSSING_EXTRA_TRACK_BUDGET = 256;
/** Maximum existing-track allocations examined with validated bridge contacts accepted. */
export const GRID_CROSSING_BRIDGE_BUDGET = 256;

/** One declared attempt of the crossing allocation search, in the order the search tries them. */
export enum CrossingAllocationPhaseId {
	/** Permute tracks and portals: the reallocation issue of the routing resource graph. */
	Reallocate = 'reallocate',
	/** Add one rail track: the growth issue, already reserved by the margin. */
	ExtraTrack = 'extra-track',
	/** Reallocate again, now accepting a crossing that a validated bridge carries. */
	Bridge = 'bridge',
}

export interface CrossingAllocationPhase {
	readonly id: CrossingAllocationPhaseId;
	/** Maximum candidates this phase evaluates; each declared issue owns an independent limit. */
	readonly budget: number;
	/** True when a contact between two parent routes is admissible if a validated bridge carries it. */
	readonly acceptBridges: boolean;
	/** Number of distinct allocations declared in this phase. */
	readonly total: (input: CrossingAllocationInput) => bigint;
	readonly candidates: (input: CrossingAllocationInput) => Generator<GridCrossingAllocation>;
}

export interface GridCrossingAllocationPhaseWitness {
	readonly id: CrossingAllocationPhaseId;
	readonly attempted: boolean;
	readonly explored: number;
	readonly total: string;
	/** False when the phase hit its own candidate budget before finding or exhausting a result. */
	readonly exhaustive: boolean;
	readonly truncated: boolean;
	readonly selected: boolean;
}

export interface GridCrossingAllocationRejectedAlternative {
	readonly phaseId: CrossingAllocationPhaseId;
	readonly busOrder: readonly string[];
	readonly code: RegionGeometryDiagnosticCode;
	readonly reason: string;
}

/** Shared bounded-search evidence plus per-issue counts for diagnostics and the workshop panel. */
export interface GridCrossingAllocationWitness extends BoundedSearchWitness<GridCrossingAllocationRejectedAlternative> {
	readonly phases: readonly GridCrossingAllocationPhaseWitness[];
	readonly winningPhase?: CrossingAllocationPhaseId;
}

function permutationCount(items: number, slots: number): bigint {
	let count = 1n;
	for (let index = 0; index < items; index += 1) count *= BigInt(slots - index);
	return count;
}

function factorial(value: number): bigint {
	let count = 1n;
	for (let factor = 2; factor <= value; factor += 1) count *= BigInt(factor);
	return count;
}

/** Exact size of the deduplicated allocation space, without constructing candidate allocations. */
export function crossingAllocationCandidateCount(
	input: CrossingAllocationInput,
	extraTracks = 0,
): bigint {
	let count = 1n;
	for (const [column, ids] of input.gutterIds.entries())
		count *= permutationCount(
			ids.length,
			defined(input.edges.gutters[column]).capacity - 1 + extraTracks,
		);
	for (const relations of input.incidence.values()) count *= factorial(relations.length);
	return count;
}

/**
 * The declared issue order of a grid conflict: reallocate, then add a track, then accept a
 * validated bridge, then `unknown`. A grid crossing relation has exactly one geometry per
 * allocation and the arrangement declares no alternative side (`alternativeSides: []`), so the
 * grid owns no detour: the detour/bridge thresholds of the contract search are vacuous here, and
 * the bridge phase is the last resource before a coded `unknown`.
 */
export function crossingAllocationPhases(
	input: CrossingAllocationInput,
): readonly CrossingAllocationPhase[] {
	return [
		{
			id: CrossingAllocationPhaseId.Reallocate,
			budget: GRID_CROSSING_REALLOCATION_BUDGET,
			acceptBridges: false,
			total: crossingAllocationCandidateCount,
			candidates: () => crossingAllocationCandidates(input),
		},
		{
			id: CrossingAllocationPhaseId.ExtraTrack,
			budget: GRID_CROSSING_EXTRA_TRACK_BUDGET,
			acceptBridges: false,
			total: (allocationInput) => crossingAllocationCandidateCount(allocationInput, 1),
			candidates: () => crossingAllocationCandidatesWithExtraTrack(input),
		},
		{
			id: CrossingAllocationPhaseId.Bridge,
			budget: GRID_CROSSING_BRIDGE_BUDGET,
			acceptBridges: true,
			total: crossingAllocationCandidateCount,
			candidates: () => crossingAllocationCandidates(input),
		},
	];
}
