import { defined } from '../document/logic-document';
import {
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import { CrossingAllocationPhaseId } from './grid-cell-crossing-witness';

export type {
	GridCrossingAllocationSelectedWitness,
	GridCrossingAllocationWitness,
} from './grid-cell-crossing-witness';
export { CrossingAllocationPhaseId } from './grid-cell-crossing-witness';

/** Maximum route geometries examined while permuting the existing gutter, bus, and port tracks. */
export const GRID_CROSSING_REALLOCATION_BUDGET = 256;
/** Maximum route geometries examined using a newly reserved gutter track. */
export const GRID_CROSSING_EXTRA_TRACK_BUDGET = 256;
/** Maximum existing-track route geometries examined with validated bridge contacts accepted. */
export const GRID_CROSSING_BRIDGE_BUDGET = 256;

export interface GridCrossingAllocationBudgets {
	readonly reallocate: number;
	readonly extraTrack: number;
	readonly bridge: number;
}

function assertPositiveSafeIntegerBudget(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError('Grid crossing allocation budgets must be positive safe integers.');
}

/** Rejects budgets that cannot guarantee an allocation is examined in each phase. */
export function validatedGridCrossingAllocationBudgets(
	budgets: GridCrossingAllocationBudgets,
): GridCrossingAllocationBudgets {
	assertPositiveSafeIntegerBudget(budgets.reallocate);
	assertPositiveSafeIntegerBudget(budgets.extraTrack);
	assertPositiveSafeIntegerBudget(budgets.bridge);
	return budgets;
}

const DEFAULT_GRID_CROSSING_ALLOCATION_BUDGETS: GridCrossingAllocationBudgets = {
	reallocate: GRID_CROSSING_REALLOCATION_BUDGET,
	extraTrack: GRID_CROSSING_EXTRA_TRACK_BUDGET,
	bridge: GRID_CROSSING_BRIDGE_BUDGET,
};

export interface CrossingAllocationPhase {
	readonly id: CrossingAllocationPhaseId;
	/** Maximum candidates this phase evaluates; each declared issue owns an independent limit. */
	readonly budget: number;
	/** True when a contact between two parent routes is admissible if a validated bridge carries it. */
	readonly acceptBridges: boolean;
	/** Exact number of distinct effective route geometries declared in this phase. */
	readonly totalGeometries: (input: CrossingAllocationInput) => bigint;
	readonly candidates: (
		input: CrossingAllocationInput,
		active?: ReadonlySet<string>,
		prioritizeBus?: boolean,
	) => Generator<GridCrossingAllocation, undefined, undefined>;
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

function allocationGeometrySpaceSize(input: CrossingAllocationInput, extraTracks: number): bigint {
	let count = permutationCount(input.busRelevantRelationIds.length, input.edges.topBus.capacity);
	let gutterAssignments = 1n;
	for (const [column, ids] of input.gutterIds.entries())
		gutterAssignments *= permutationCount(
			ids.length,
			defined(input.edges.gutters[column]).capacity - 1 + extraTracks,
		);
	count *= gutterAssignments;
	for (const relations of input.incidence.values()) count *= factorial(relations.length);
	return count;
}

/** Exact number of geometries after ignoring unused bus tracks and assignments without a new track. */
export function crossingAllocationGeometryCount(
	input: CrossingAllocationInput,
	extraTracks = 0,
): bigint {
	const extended = allocationGeometrySpaceSize(input, extraTracks);
	if (extraTracks === 0) return extended;
	return extended - allocationGeometrySpaceSize(input, 0);
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
	budgets: GridCrossingAllocationBudgets = DEFAULT_GRID_CROSSING_ALLOCATION_BUDGETS,
): readonly CrossingAllocationPhase[] {
	validatedGridCrossingAllocationBudgets(budgets);
	return [
		{
			id: CrossingAllocationPhaseId.Reallocate,
			budget: budgets.reallocate,
			acceptBridges: false,
			totalGeometries: crossingAllocationGeometryCount,
			candidates: (_input, active, prioritizeBus) =>
				crossingAllocationCandidates(input, active, prioritizeBus),
		},
		{
			id: CrossingAllocationPhaseId.ExtraTrack,
			budget: budgets.extraTrack,
			acceptBridges: false,
			totalGeometries: (allocationInput) => crossingAllocationGeometryCount(allocationInput, 1),
			candidates: (_input, active) => crossingAllocationCandidatesWithExtraTrack(input, active),
		},
		{
			id: CrossingAllocationPhaseId.Bridge,
			budget: budgets.bridge,
			acceptBridges: true,
			totalGeometries: crossingAllocationGeometryCount,
			candidates: (_input, active, prioritizeBus) =>
				crossingAllocationCandidates(input, active, prioritizeBus),
		},
	];
}
