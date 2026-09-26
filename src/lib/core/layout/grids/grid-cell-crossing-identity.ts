import { compareCanonicalStrings } from '../../canonical-string';
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
	busRelevant: ReadonlySet<string>,
): string {
	return JSON.stringify([
		gutterOrders.map((order) => orderEntries(order)),
		orderEntries(busOrder, busRelevant),
		[...portOrders]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, order]) => [endpointId, orderEntries(order)]),
	]);
}

export function geometryKeyFromAllocation(
	gutterTracks: readonly ReadonlyMap<string, number>[],
	busTracks: ReadonlyMap<string, number>,
	portTracks: ReadonlyMap<string, ReadonlyMap<string, number>>,
	busRelevant: ReadonlySet<string>,
): string {
	return JSON.stringify([
		gutterTracks.map((tracks) => mapEntries(tracks)),
		mapEntries(busTracks, busRelevant),
		[...portTracks]
			.sort(([left], [right]) => compareCanonicalStrings(left, right))
			.map(([endpointId, tracks]) => [endpointId, mapEntries(tracks)]),
	]);
}
