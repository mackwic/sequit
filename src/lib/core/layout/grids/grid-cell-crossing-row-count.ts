import { defined } from '../../document/logic-document';
import type { CrossingAllocationInput } from './grid-cell-crossing-allocation-types';

interface RowLoadState {
	readonly loads: readonly number[];
	readonly count: bigint;
}

function rowChoices(input: CrossingAllocationInput): readonly number[][] {
	const rowsByRelationId = new Map<string, number[]>();
	for (const [row, ids] of (input.rowGutterIds ?? []).entries())
		for (const id of ids) {
			let rows = rowsByRelationId.get(id);
			if (rows === undefined) {
				rows = [];
				rowsByRelationId.set(id, rows);
			}
			if (rows.at(-1) !== row) rows.push(row);
		}
	const choices: number[][] = [];
	for (const id of input.crossingIds) {
		const rows = rowsByRelationId.get(id);
		if (rows !== undefined) choices.push(rows);
	}
	return choices;
}

function allRowGeometryCount(
	choices: readonly (readonly number[])[],
	capacities: readonly number[],
	limit?: bigint,
): bigint {
	const slots = capacities.reduce((total, capacity) => total + capacity, 0);
	let total = 1n;
	let selections = 1n;
	let tracks = 1n;
	for (let selected = 1; selected <= choices.length; selected += 1) {
		const remaining = choices.length - selected + 1;
		selections = (selections * BigInt(remaining)) / BigInt(selected);
		tracks *= BigInt(slots - selected + 1);
		total += selections * tracks;
		if (limit !== undefined && total > limit) return limit + 1n;
	}
	return total;
}

function addRowState(
	states: Map<string, RowLoadState>,
	loads: readonly number[],
	count: bigint,
): void {
	const key = loads.join(',');
	const previous = states.get(key);
	states.set(key, { loads, count: count + (previous?.count ?? 0n) });
}

function addRowChoice(
	states: Map<string, RowLoadState>,
	state: RowLoadState,
	row: number,
	capacities: readonly number[],
): bigint {
	const used = defined(state.loads[row]);
	const available = defined(capacities[row]) - used;
	if (available === 0) return 0n;
	const loads = [...state.loads];
	loads[row] = used + 1;
	const count = state.count * BigInt(available);
	addRowState(states, loads, count);
	return count;
}

function nextRowStates(
	states: ReadonlyMap<string, RowLoadState>,
	rows: readonly number[],
	capacities: readonly number[],
	limit?: bigint,
): { readonly states: Map<string, RowLoadState>; readonly total: bigint } {
	const next = new Map<string, RowLoadState>();
	let total = 0n;
	for (const state of states.values()) {
		addRowState(next, state.loads, state.count);
		total += state.count;
		if (limit !== undefined && total > limit) return { states: next, total: limit + 1n };
		for (const row of rows) {
			total += addRowChoice(next, state, row, capacities);
			if (limit !== undefined && total > limit) return { states: next, total: limit + 1n };
		}
	}
	return { states: next, total };
}

function partialRowGeometryCount(
	choices: readonly (readonly number[])[],
	capacities: readonly number[],
	limit?: bigint,
): bigint {
	let states = new Map<string, RowLoadState>([['', { loads: capacities.map(() => 0), count: 1n }]]);
	let total = 1n;
	for (const rows of choices) {
		const next = nextRowStates(states, rows, capacities, limit);
		if (limit !== undefined && next.total > limit) return limit + 1n;
		states = next.states;
		total = next.total;
	}
	return total;
}

/** A relation uses one eligible separation or the bus; row choices are counted
 * iteratively and stop at budget + 1 before a combinatorial state space is built. */
export function rowGeometryCount(input: CrossingAllocationInput, limit?: bigint): bigint {
	const choices = rowChoices(input);
	if (choices.length === 0) return 1n;
	// Bus-only plus one valid choice per relation already proves non-exhaustion.
	if (limit !== undefined && BigInt(choices.length) >= limit) return limit + 1n;
	const capacities = (input.rowGutterIds ?? []).map((ids) => ids.length);
	if (choices.every((rows) => rows.length === capacities.length))
		return allRowGeometryCount(choices, capacities, limit);
	return partialRowGeometryCount(choices, capacities, limit);
}
