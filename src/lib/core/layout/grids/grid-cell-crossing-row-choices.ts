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
	readonly chosenRowById: Map<string, number>;
}

function* choicesForCost(
	allocation: GridCrossingAllocation,
	context: RowChoiceContext,
	index: number,
	remainingCost: number,
): Generator<GridCrossingAllocation> {
	if (index === context.eligible.length) {
		if (remainingCost !== 0) return;
		const rowTracks = chosenRowTracks(allocation, context.chosenRowById);
		const candidate = { ...allocation, rowTrackByRelationId: rowTracks };
		const key = geometryKeyFromAllocation(candidate, context.busRelevant);
		if (context.seen.has(key)) return;
		context.seen.add(key);
		yield candidate;
		return;
	}
	const id = defined(context.eligible[index]);
	const rows = defined(context.rowsByRelationId.get(id));
	// Preserve the historical first candidate (each relation on its first row).
	context.chosenRowById.set(id, defined(rows[0]));
	yield* choicesForCost(allocation, context, index + 1, remainingCost);
	for (let choice = 1; choice < rows.length; choice += 1) {
		if (remainingCost < choice) continue;
		context.chosenRowById.set(id, defined(rows[choice]));
		yield* choicesForCost(allocation, context, index + 1, remainingCost - choice);
	}
	context.chosenRowById.delete(id);
	if (remainingCost > 0) yield* choicesForCost(allocation, context, index + 1, remainingCost - 1);
}

/** A relation chooses one eligible row separation or the top bus. Increasing total
 * choice cost exposes each relation's alternatives before expanding the Cartesian tail. */
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
		chosenRowById: new Map<string, number>(),
	};
	const maximumCost = eligible.reduce(
		(sum, id) => sum + Math.max(1, defined(rowsByRelationId.get(id)).length - 1),
		0,
	);
	for (const allocation of allocations)
		for (let cost = 0; cost <= maximumCost; cost += 1)
			yield* choicesForCost(allocation, context, 0, cost);
}
