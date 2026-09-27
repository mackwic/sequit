import { defined } from '../../document/logic-document';
import { indexVectors } from '../geometry/index-vectors';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { geometryKeyFromAllocation } from './grid-cell-crossing-identity';

interface RowChoiceContext {
	readonly input: CrossingAllocationInput;
	readonly eligible: readonly string[];
	readonly rowsByRelationId: ReadonlyMap<string, readonly number[]>;
	readonly active: ReadonlySet<string> | undefined;
}

interface AllocationStream {
	readonly cached: GridCrossingAllocation[];
	readonly iterator: Generator<GridCrossingAllocation>;
	exhausted: boolean;
}

function allocationAt(stream: AllocationStream, index: number): GridCrossingAllocation | undefined {
	while (stream.cached.length <= index && !stream.exhausted) {
		const next = stream.iterator.next();
		if (next.done === true) stream.exhausted = true;
		else stream.cached.push(next.value);
	}
	return stream.cached[index];
}

function eligibleRows(input: CrossingAllocationInput): Map<string, number[]> {
	const rowsByRelationId = new Map<string, number[]>();
	for (const [row, ids] of (input.rowGutterIds ?? []).entries())
		for (const id of ids) {
			let rows = rowsByRelationId.get(id);
			if (rows === undefined) {
				rows = [];
				rowsByRelationId.set(id, rows);
			}
			rows.push(row);
		}
	return rowsByRelationId;
}

function chosenRowTracks(
	allocation: GridCrossingAllocation,
	chosenRowById: ReadonlyMap<string, number>,
): readonly ReadonlyMap<string, number>[] {
	return defined(allocation.rowTrackByRelationId).map((tracks, row) => {
		const chosen = new Map<string, number>();
		for (const [id, track] of tracks) if (chosenRowById.get(id) === row) chosen.set(id, track);
		return chosen;
	});
}

function chosenAllocation(
	allocation: GridCrossingAllocation,
	eligible: readonly string[],
	rowsByRelationId: ReadonlyMap<string, readonly number[]>,
	indices: readonly number[],
): GridCrossingAllocation {
	const chosenRowById = new Map<string, number>();
	for (const [index, id] of eligible.entries()) {
		const rows = defined(rowsByRelationId.get(id));
		const row = rows[defined(indices[index + 1])];
		if (row !== undefined) chosenRowById.set(id, row);
	}
	return { ...allocation, rowTrackByRelationId: chosenRowTracks(allocation, chosenRowById) };
}

function rowChoiceLimit(id: string, context: RowChoiceContext): number {
	if (context.active !== undefined && !context.active.has(id)) return 0;
	return defined(context.rowsByRelationId.get(id)).length;
}

function vectorLimit(
	dimension: number,
	diagonal: number,
	stream: AllocationStream,
	context: RowChoiceContext,
): number {
	if (dimension !== 0) return rowChoiceLimit(defined(context.eligible[dimension - 1]), context);
	if (stream.exhausted) return stream.cached.length - 1;
	return diagonal;
}

function* fairRowCandidates(
	context: RowChoiceContext,
	allocations: Generator<GridCrossingAllocation>,
): Generator<GridCrossingAllocation> {
	const { eligible, rowsByRelationId } = context;
	const seen = new Set<string>();
	const busRelevant = new Set(context.input.busRelevantRelationIds);
	const stream: AllocationStream = { cached: [], iterator: allocations, exhausted: false };
	const rowDepth = eligible.reduce((sum, id) => sum + rowChoiceLimit(id, context), 0);
	for (let diagonal = 0; ; diagonal += 1) {
		const limit = stream.cached.length + rowDepth;
		if (stream.exhausted && diagonal >= limit) break;
		for (const indices of indexVectors(eligible.length + 1, diagonal, (dimension) =>
			vectorLimit(dimension, diagonal, stream, context),
		)) {
			const allocation = allocationAt(stream, defined(indices[0]));
			if (allocation === undefined) continue;
			const candidate = chosenAllocation(allocation, eligible, rowsByRelationId, indices);
			const key = geometryKeyFromAllocation(candidate, busRelevant);
			if (seen.has(key)) continue;
			seen.add(key);
			yield candidate;
		}
	}
}

/** A relation uses exactly one row separation or the bus. Diagonals interleave the base
 * bus/gutter/port allocation with row alternatives: neither dimension exhausts the 256 budget
 * before the other's next choice is tried. The first canonical candidate is unchanged. */
export function* withRowRouteChoices(
	input: CrossingAllocationInput,
	allocations: Generator<GridCrossingAllocation>,
	active?: ReadonlySet<string>,
): Generator<GridCrossingAllocation> {
	const rowsByRelationId = eligibleRows(input);
	const eligible = input.crossingIds.filter((id) => rowsByRelationId.has(id));
	if (eligible.length === 0) {
		yield* allocations;
		return;
	}
	yield* fairRowCandidates({ input, eligible, rowsByRelationId, active }, allocations);
}
