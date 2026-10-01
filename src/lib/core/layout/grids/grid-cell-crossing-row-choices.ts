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
/** Tracks reassigned by `rank`, each rank keeping its own order, on the slots already used. */
function rankedTracks(
	tracks: ReadonlyMap<string, number>,
	rank: (id: string) => number,
): ReadonlyMap<string, number> {
	const ordered = [...tracks].sort(
		(left, right) => rank(left[0]) - rank(right[0]) || left[1] - right[1],
	);
	const slots = [...tracks.values()].sort((left, right) => left - right);
	return new Map(ordered.map(([id], index) => [id, defined(slots[index])]));
}

/**
 * Tracks from the inside out. A relation that takes a row gutter leaves its column gutter inside
 * the grid, one that stays in its column turns back along it, and one that crosses columns over
 * the top bus climbs past both: they take column tracks from the innermost (track 0) outwards in
 * that order. Only the last kind reaches the bus, where it takes the tracks nearest the grid
 * (the highest ones).
 */
function rowRoutedInnermost(
	allocation: GridCrossingAllocation,
	chosenRowById: ReadonlyMap<string, number>,
): GridCrossingAllocation {
	const columns = new Map<string, number>();
	for (const tracks of allocation.gutterTrackByRelationId)
		for (const id of tracks.keys()) columns.set(id, (columns.get(id) ?? 0) + 1);
	const outward = (id: string) => {
		if (chosenRowById.has(id)) return 0;
		return Math.min(2, columns.get(id) ?? 0);
	};
	return {
		...allocation,
		gutterTrackByRelationId: allocation.gutterTrackByRelationId.map((tracks) =>
			rankedTracks(tracks, outward),
		),
		busTrackByRelationId: rankedTracks(allocation.busTrackByRelationId, (id) =>
			Number(outward(id) === 2),
		),
	};
}

function* uniqueCandidates(
	candidates: readonly GridCrossingAllocation[],
	context: RowChoiceContext,
): Generator<GridCrossingAllocation> {
	for (const candidate of candidates) {
		const key = geometryKeyFromAllocation(candidate, context.busRelevant);
		if (context.seen.has(key)) continue;
		context.seen.add(key);
		yield candidate;
	}
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
		// The reordered tracks come first; the allocation as declared still follows.
		const innermost = rowRoutedInnermost(candidate, context.chosenRowById);
		yield* uniqueCandidates([innermost, candidate], context);
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
