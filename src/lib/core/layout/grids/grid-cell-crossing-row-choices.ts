import { defined } from '../../document/logic-document';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { geometryKeyFromAllocation } from './grid-cell-crossing-identity';

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

interface RowChoiceContext {
	readonly eligible: readonly string[];
	readonly rowsByRelationId: ReadonlyMap<string, readonly number[]>;
	readonly seen: Set<string>;
	readonly busRelevant: ReadonlySet<string>;
}

function* choicesForAllocation(
	allocation: GridCrossingAllocation,
	context: RowChoiceContext,
	index: number,
	chosenRowById: Map<string, number>,
): Generator<GridCrossingAllocation> {
	if (index === context.eligible.length) {
		const rowTracks = chosenRowTracks(allocation, chosenRowById);
		const candidate = { ...allocation, rowTrackByRelationId: rowTracks };
		const key = geometryKeyFromAllocation(candidate, context.busRelevant);
		if (context.seen.has(key)) return;
		context.seen.add(key);
		yield candidate;
		return;
	}
	const id = defined(context.eligible[index]);
	for (const row of defined(context.rowsByRelationId.get(id))) {
		chosenRowById.set(id, row);
		yield* choicesForAllocation(allocation, context, index + 1, chosenRowById);
	}
	chosenRowById.delete(id);
	yield* choicesForAllocation(allocation, context, index + 1, chosenRowById);
}

/** A relation chooses exactly one eligible row separation or the top bus. Distinct choices
 * share the existing search phase and its budget instead of creating a second allocator. */
export function* withRowRouteChoices(
	input: CrossingAllocationInput,
	allocations: Generator<GridCrossingAllocation>,
): Generator<GridCrossingAllocation> {
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
	const eligible = input.crossingIds.filter((id) => rowsByRelationId.has(id));
	if (eligible.length === 0) {
		yield* allocations;
		return;
	}
	const context = {
		eligible,
		rowsByRelationId,
		seen: new Set<string>(),
		busRelevant: new Set(input.busRelevantRelationIds),
	};
	for (const allocation of allocations)
		yield* choicesForAllocation(allocation, context, 0, new Map());
}
