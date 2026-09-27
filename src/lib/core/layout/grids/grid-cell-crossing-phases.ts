import { defined } from '../../document/logic-document';
import { CrossingAllocationPhaseId } from '../search/grid-cell-crossing-witness';
import {
	crossingAllocationCandidates,
	crossingAllocationCandidatesWithExtraTrack,
} from './grid-cell-crossing-allocation';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { rowGeometryCount } from './grid-cell-crossing-row-count';

export type {
	GridCrossingAllocationSelectedWitness,
	GridCrossingAllocationWitness,
} from '../search/grid-cell-crossing-witness';
export { CrossingAllocationPhaseId } from '../search/grid-cell-crossing-witness';

/** Maximum route geometries examined with horizontal row alternatives and canonical bus. */
export const GRID_CROSSING_ROW_GUTTER_BUDGET = 256;
/** Maximum route geometries examined while permuting the existing gutter, bus, and port tracks. */
export const GRID_CROSSING_REALLOCATION_BUDGET = 256;
/** Maximum route geometries examined using a newly reserved gutter track. */
export const GRID_CROSSING_EXTRA_TRACK_BUDGET = 256;
/** Maximum existing-track route geometries examined with validated bridge contacts accepted. */
export const GRID_CROSSING_BRIDGE_BUDGET = 256;

export interface GridCrossingAllocationBudgets {
	readonly rowGutter: number;
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
	assertPositiveSafeIntegerBudget(budgets.rowGutter);
	assertPositiveSafeIntegerBudget(budgets.reallocate);
	assertPositiveSafeIntegerBudget(budgets.extraTrack);
	assertPositiveSafeIntegerBudget(budgets.bridge);
	return budgets;
}

const DEFAULT_GRID_CROSSING_ALLOCATION_BUDGETS: GridCrossingAllocationBudgets = {
	rowGutter: GRID_CROSSING_ROW_GUTTER_BUDGET,
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
	/** Exact up to the budget; budget + 1 proves a larger space without counting its tail. */
	readonly totalGeometries: () => bigint;
	readonly candidates: (
		active?: ReadonlySet<string>,
		prioritizeBus?: boolean,
	) => Generator<GridCrossingAllocation, undefined, undefined>;
}

function permutationCount(items: number, slots: number, limit?: bigint): bigint {
	let count = 1n;
	for (let index = 0; index < items; index += 1) {
		count *= BigInt(slots - index);
		if (limit !== undefined && count > limit) return limit + 1n;
	}
	return count;
}

function factorial(value: number, limit?: bigint): bigint {
	let count = 1n;
	for (let factor = 2; factor <= value; factor += 1) {
		count *= BigInt(factor);
		if (limit !== undefined && count > limit) return limit + 1n;
	}
	return count;
}

function cappedCount(count: bigint, limit: bigint | undefined): bigint {
	if (limit !== undefined && count > limit) return limit + 1n;
	return count;
}

function allocationGeometrySpaceSize(
	input: CrossingAllocationInput,
	limit?: bigint,
	canonicalBus = false,
): bigint {
	let count = 1n;
	if (!canonicalBus)
		count = permutationCount(
			input.busRelevantRelationIds.length,
			input.edges.topBus.capacity,
			limit,
		);
	if (limit !== undefined && count > limit) return limit + 1n;
	for (const [column, ids] of input.gutterIds.entries()) {
		count *= permutationCount(ids.length, defined(input.edges.gutters[column]).capacity - 1, limit);
		if (limit !== undefined && count > limit) return limit + 1n;
	}
	count *= rowGeometryCount(input, limit);
	if (limit !== undefined && count > limit) return limit + 1n;
	for (const relations of input.incidence.values()) {
		count *= factorial(relations.length, limit);
		if (limit !== undefined && count > limit) return limit + 1n;
	}
	return count;
}

/** Number of geometries with the first bus assignment held fixed. */
export function crossingCanonicalBusGeometryCount(
	input: CrossingAllocationInput,
	extraTracks: 0 | 1 = 0,
	budget?: number,
): bigint {
	return crossingGeometryCount(input, extraTracks, budget, true);
}

/** An extra-track geometry grows exactly one gutter; its reserved slot must be occupied.
 * With n existing relations on that gutter, there are n choices for the route taking the new
 * slot and n! arrangements for the rest, i.e. n times the base gutter permutation count. */
function crossingGeometryCount(
	input: CrossingAllocationInput,
	extraTracks: 0 | 1,
	budget?: number,
	canonicalBus = false,
): bigint {
	let limit: bigint | undefined;
	if (budget !== undefined) limit = BigInt(budget);
	const base = allocationGeometrySpaceSize(input, limit, canonicalBus);
	if (extraTracks === 0) return base;
	let availableLoad = 0;
	for (const [column, ids] of input.gutterIds.entries())
		if (input.blockedExtraGutterColumns?.has(column) !== true) availableLoad += ids.length;
	return cappedCount(base * BigInt(availableLoad), limit);
}

/** Exact on small spaces; with a budget, returns budget + 1 as a lower bound once exceeded. */
export function crossingAllocationGeometryCount(
	input: CrossingAllocationInput,
	extraTracks: 0 | 1 = 0,
	budget?: number,
): bigint {
	return crossingGeometryCount(input, extraTracks, budget);
}

/**
 * The declared issue order: horizontal row tracks, legacy upper-bus reallocation,
 * then add a track, then accept a validated bridge, then `unknown`. A grid crossing relation has exactly one geometry per
 * allocation and the arrangement declares no alternative side (`alternativeSides: []`), so the
 * grid owns no detour: the detour/bridge thresholds of the contract search are vacuous here, and
 * the bridge phase is the last resource before a coded `unknown`.
 */
export function crossingAllocationPhases(
	input: CrossingAllocationInput,
	budgets: GridCrossingAllocationBudgets = DEFAULT_GRID_CROSSING_ALLOCATION_BUDGETS,
): readonly CrossingAllocationPhase[] {
	validatedGridCrossingAllocationBudgets(budgets);
	const rowInput = { ...input, busRelevantRelationIds: [] };
	const busInput = { ...input, rowGutterIds: [] };
	return [
		{
			id: CrossingAllocationPhaseId.RowGutter,
			budget: budgets.rowGutter,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(rowInput, 0, budgets.rowGutter),
			candidates: (active) => crossingAllocationCandidates(rowInput, active),
		},
		{
			id: CrossingAllocationPhaseId.Reallocate,
			budget: budgets.reallocate,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(busInput, 0, budgets.reallocate),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(busInput, active, prioritizeBus),
		},
		{
			id: CrossingAllocationPhaseId.ExtraTrack,
			budget: budgets.extraTrack,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(busInput, 1, budgets.extraTrack),
			candidates: (active) => crossingAllocationCandidatesWithExtraTrack(busInput, active),
		},
		{
			id: CrossingAllocationPhaseId.Bridge,
			budget: budgets.bridge,
			acceptBridges: true,
			totalGeometries: () => crossingAllocationGeometryCount(busInput, 0, budgets.bridge),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(busInput, active, prioritizeBus),
		},
	];
}
