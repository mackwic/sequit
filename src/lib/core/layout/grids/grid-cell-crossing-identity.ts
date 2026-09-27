import { compareCanonicalStrings } from '../../canonical-string';
import type { GridCrossingAllocation } from './grid-cell-crossing-allocation-types';
import { FREE_TRACK } from './grid-cell-crossing-orders';

type TrackEntries = readonly (readonly [string, number])[];

function sortedEntries(entries: [string, number][]): TrackEntries {
	return entries.sort(([left], [right]) => compareCanonicalStrings(left, right));
}

function orderEntries(order: readonly string[], relevant?: ReadonlySet<string>): TrackEntries {
	const entries: [string, number][] = [];
	for (const [track, relationId] of order.entries()) {
		if (relationId === FREE_TRACK) continue;
		if (relevant !== undefined && !relevant.has(relationId)) continue;
		entries.push([relationId, track]);
	}
	return sortedEntries(entries);
}

function mapEntries(
	tracks: ReadonlyMap<string, number>,
	relevant?: ReadonlySet<string>,
): TrackEntries {
	const entries: [string, number][] = [];
	for (const [relationId, track] of tracks)
		if (relevant === undefined || relevant.has(relationId)) entries.push([relationId, track]);
	return sortedEntries(entries);
}

/** Identity is the effective gutter, bus and face geometry, independent of map insertion order.
 * Bus tracks unused by same-rail relations do not distinguish route geometries. */
export function geometryKeyFromOrders(
	gutterOrders: readonly (readonly string[])[],
	busOrder: readonly string[],
	portOrders: ReadonlyMap<string, readonly string[]>,
	context: {
		readonly busRelevant: ReadonlySet<string>;
		readonly rowTracks: readonly (readonly string[])[];
	},
): string {
	return JSON.stringify([
		gutterOrders.map((order) => orderEntries(order)),
		context.rowTracks.map((order) => orderEntries(order)),
		orderEntries(busOrder, context.busRelevant),
		[...portOrders]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, order]) => [endpointId, orderEntries(order)]),
	]);
}

export function geometryKeyFromAllocation(
	allocation: GridCrossingAllocation,
	busRelevant: ReadonlySet<string>,
): string {
	return JSON.stringify([
		allocation.gutterTrackByRelationId.map((tracks) => mapEntries(tracks)),
		(allocation.rowTrackByRelationId ?? []).map((tracks) => mapEntries(tracks)),
		mapEntries(allocation.busTrackByRelationId, busRelevant),
		[...allocation.portTrackByEndpointId]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, tracks]) => [endpointId, mapEntries(tracks)]),
	]);
}
