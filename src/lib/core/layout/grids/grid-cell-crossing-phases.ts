import { defined } from '../../document/logic-document';
import { CrossingAllocationPhaseId } from '../search/grid-cell-crossing-witness';
import {
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
	type CrossingAllocationInput,
	type GridCrossingAllocation,
} from './grid-cell-crossing-allocation';

export type {
	GridCrossingAllocationSelectedWitness,
	GridCrossingAllocationWitness,
} from '../search/grid-cell-crossing-witness';
export { CrossingAllocationPhaseId } from '../search/grid-cell-crossing-witness';

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
	readonly totalGeometries: () => bigint;
	readonly candidates: (
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

function allocationGeometrySpaceSize(input: CrossingAllocationInput): bigint {
	let count = permutationCount(input.busRelevantRelationIds.length, input.edges.topBus.capacity);
	let gutterAssignments = 1n;
	for (const [column, ids] of input.gutterIds.entries())
		gutterAssignments *= permutationCount(
			ids.length,
			defined(input.edges.gutters[column]).capacity - 1,
		);
	count *= gutterAssignments;
	for (const relations of input.incidence.values()) count *= factorial(relations.length);
	return count;
}

/** Number of geometries with the first bus assignment held fixed. */
export function crossingCanonicalBusGeometryCount(
	input: CrossingAllocationInput,
	extraTracks: 0 | 1 = 0,
): bigint {
	const busOrders = permutationCount(
		input.busRelevantRelationIds.length,
		input.edges.topBus.capacity,
	);
	return crossingAllocationGeometryCount(input, extraTracks) / busOrders;
}

/** An extra-track geometry grows exactly one gutter; its reserved slot must be occupied.
 * With n existing relations on that gutter, there are n choices for the route taking the new
 * slot and n! arrangements for the rest, i.e. n times the base gutter permutation count. */
export function crossingAllocationGeometryCount(
	input: CrossingAllocationInput,
	extraTracks: 0 | 1 = 0,
): bigint {
	const base = allocationGeometrySpaceSize(input);
	if (extraTracks === 0) return base;
	let availableLoad = 0;
	for (const [column, ids] of input.gutterIds.entries())
		if (input.blockedExtraGutterColumns?.has(column) !== true) availableLoad += ids.length;
	return base * BigInt(availableLoad);
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
			totalGeometries: () => crossingAllocationGeometryCount(input),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(input, active, prioritizeBus),
		},
		{
			id: CrossingAllocationPhaseId.ExtraTrack,
			budget: budgets.extraTrack,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(input, 1),
			candidates: (active) => crossingAllocationCandidatesWithExtraTrack(input, active),
		},
		{
			id: CrossingAllocationPhaseId.Bridge,
			budget: budgets.bridge,
			acceptBridges: true,
			totalGeometries: () => crossingAllocationGeometryCount(input),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(input, active, prioritizeBus),
		},
	];
}
