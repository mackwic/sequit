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

/** A relation uses one eligible separation or the bus; selected relations take distinct
 * tracks within their chosen row edge. Memoize loads rather than materializing geometries. */
function rowGeometryCount(input: CrossingAllocationInput): bigint {
	const eligible = input.crossingIds.filter((id) =>
		(input.rowGutterIds ?? []).some((ids) => ids.includes(id)),
	);
	if (eligible.length === 0) return 1n;
	const boundaries = eligible.map((id) => {
		const rows: number[] = [];
		for (const [row, ids] of (input.rowGutterIds ?? []).entries())
			if (ids.includes(id)) rows.push(row);
		return rows;
	});
	const capacities = (input.rowGutterIds ?? []).map((ids) => ids.length);
	if (boundaries.every((rows) => rows.length === capacities.length)) {
		const slots = capacities.reduce((total, capacity) => total + capacity, 0);
		let total = 1n;
		let choices = 1n;
		let tracks = 1n;
		for (let selected = 1; selected <= eligible.length; selected += 1) {
			const remaining = eligible.length - selected + 1;
			choices = (choices * BigInt(remaining)) / BigInt(selected);
			tracks *= BigInt(slots - selected + 1);
			total += choices * tracks;
		}
		return total;
	}
	const loads = capacities.map(() => 0);
	const memo = new Map<string, bigint>();
	function count(index: number): bigint {
		if (index === eligible.length) return 1n;
		const key = `${index}:${loads.join(',')}`;
		const cached = memo.get(key);
		if (cached !== undefined) return cached;
		let total = count(index + 1);
		for (const row of defined(boundaries[index])) {
			const used = defined(loads[row]);
			if (used === defined(capacities[row])) continue;
			loads[row] = used + 1;
			const available = defined(capacities[row]) - used;
			total += BigInt(available) * count(index + 1);
			loads[row] = used;
		}
		memo.set(key, total);
		return total;
	}
	return count(0);
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
	count *= rowGeometryCount(input);
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
			totalGeometries: () => crossingAllocationGeometryCount(rowInput),
			candidates: (active) => crossingAllocationCandidates(rowInput, active),
		},
		{
			id: CrossingAllocationPhaseId.Reallocate,
			budget: budgets.reallocate,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(busInput),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(busInput, active, prioritizeBus),
		},
		{
			id: CrossingAllocationPhaseId.ExtraTrack,
			budget: budgets.extraTrack,
			acceptBridges: false,
			totalGeometries: () => crossingAllocationGeometryCount(busInput, 1),
			candidates: (active) => crossingAllocationCandidatesWithExtraTrack(busInput, active),
		},
		{
			id: CrossingAllocationPhaseId.Bridge,
			budget: budgets.bridge,
			acceptBridges: true,
			totalGeometries: () => crossingAllocationGeometryCount(busInput),
			candidates: (active, prioritizeBus) =>
				crossingAllocationCandidates(busInput, active, prioritizeBus),
		},
	];
}
