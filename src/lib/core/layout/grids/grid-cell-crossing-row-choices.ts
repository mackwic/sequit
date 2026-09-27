import { defined } from '../../document/logic-document';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation-types';
import { geometryKeyFromAllocation } from './grid-cell-crossing-identity';

function rowTracksWithoutBus(
	allocation: GridCrossingAllocation,
	busIds: ReadonlySet<string>,
): readonly ReadonlyMap<string, number>[] {
	const tracks = defined(allocation.rowTrackByRelationId);
	if (busIds.size === 0) return tracks;
	return tracks.map((row) => new Map([...row].filter(([id]) => !busIds.has(id))));
}

interface RowChoiceContext {
	readonly eligible: readonly string[];
	readonly seen: Set<string>;
	readonly busRelevant: ReadonlySet<string>;
}

function* choicesForAllocation(
	allocation: GridCrossingAllocation,
	context: RowChoiceContext,
	index: number,
	busIds: Set<string>,
): Generator<GridCrossingAllocation> {
	if (index === context.eligible.length) {
		const rowTracks = rowTracksWithoutBus(allocation, busIds);
		const candidate = { ...allocation, rowTrackByRelationId: rowTracks };
		const key = geometryKeyFromAllocation(candidate, context.busRelevant);
		if (context.seen.has(key)) return;
		context.seen.add(key);
		yield candidate;
		return;
	}
	const id = defined(context.eligible[index]);
	yield* choicesForAllocation(allocation, context, index + 1, busIds);
	busIds.add(id);
	yield* choicesForAllocation(allocation, context, index + 1, busIds);
	busIds.delete(id);
}

/** Each selected row-track assignment can fall back independently to the top bus. The
 * declared iterator yields distinct effective allocations, including mixed row/bus paths. */
export function* withRowRouteChoices(
	input: CrossingAllocationInput,
	allocations: Generator<GridCrossingAllocation>,
): Generator<GridCrossingAllocation> {
	const eligible = (input.rowGutterIds ?? []).flat();
	if (eligible.length === 0) {
		yield* allocations;
		return;
	}
	const context = {
		eligible,
		seen: new Set<string>(),
		busRelevant: new Set(input.busRelevantRelationIds),
	};
	for (const allocation of allocations)
		yield* choicesForAllocation(allocation, context, 0, new Set());
}
