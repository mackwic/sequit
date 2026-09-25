import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { RoutingEdge, RoutingTrackAllocation } from './routing-resource-allocation';

/** One route band and the track assignments the selected strategy actually reads from it. */
export interface TrackAssignmentDomain {
	readonly id: string;
	readonly edge: RoutingEdge;
	readonly trackCount: number;
	readonly relationIds: readonly string[];
	readonly baseline: RoutingTrackAllocation;
}

/** One effective combination of track maps, with a stable canonical key for tie-breaking. */
export interface TrackAllocationProduct {
	readonly allocations: readonly RoutingTrackAllocation[];
	readonly key: string;
}

function domainRelationIds(domain: TrackAssignmentDomain): readonly string[] {
	const ids = [...domain.relationIds].sort(compareCanonicalStrings);
	if (new Set(ids).size !== ids.length)
		throw new Error(`Duplicate route identity in ${domain.id}.`);
	if (!Number.isSafeInteger(domain.trackCount) || domain.trackCount < ids.length)
		throw new Error(`Invalid track count in ${domain.id}.`);
	if (domain.trackCount > domain.edge.capacity)
		throw new Error(`Track count exceeds edge capacity in ${domain.id}.`);
	return ids;
}

function allocationFor(
	domain: TrackAssignmentDomain,
	tracks: ReadonlyMap<string, number>,
): RoutingTrackAllocation {
	return { edge: domain.edge, trackByRelationId: tracks };
}

function baselineFor(domain: TrackAssignmentDomain): RoutingTrackAllocation {
	const tracks = new Map<string, number>();
	for (const id of domainRelationIds(domain))
		tracks.set(id, defined(domain.baseline.trackByRelationId.get(id)));
	return allocationFor(domain, tracks);
}

function assignmentKey(domain: TrackAssignmentDomain, allocation: RoutingTrackAllocation): string {
	return JSON.stringify(
		domainRelationIds(domain).map((id) => [id, defined(allocation.trackByRelationId.get(id))]),
	);
}

/** Exact number of injective assignments of the active routes to their used tracks. */
export function trackAssignmentCount(domain: TrackAssignmentDomain): bigint {
	const ids = domainRelationIds(domain);
	let count = 1n;
	for (let index = 0; index < ids.length; index += 1) count *= BigInt(domain.trackCount - index);
	return count;
}

/** Exact cardinality of the independent route-band product, without materializing it. */
export function trackAllocationProductCount(domains: readonly TrackAssignmentDomain[]): bigint {
	let count = 1n;
	for (const domain of domains) count *= trackAssignmentCount(domain);
	return count;
}

/** Assignments for one band: its historical map first, then canonical-ID/track-order injections. */
function* assignments(domain: TrackAssignmentDomain): Generator<RoutingTrackAllocation> {
	const ids = domainRelationIds(domain);
	const baseline = baselineFor(domain);
	const baselineKey = assignmentKey(domain, baseline);
	yield baseline;

	const assigned = new Map<string, number>();
	const usedTracks = new Set<number>();
	function* visit(index: number): Generator<RoutingTrackAllocation> {
		if (index === ids.length) {
			const candidate = allocationFor(domain, new Map(assigned));
			if (assignmentKey(domain, candidate) !== baselineKey) yield candidate;
			return;
		}
		const id = defined(ids[index]);
		for (let track = 0; track < domain.trackCount; track += 1) {
			if (usedTracks.has(track)) continue;
			assigned.set(id, track);
			usedTracks.add(track);
			yield* visit(index + 1);
			assigned.delete(id);
			usedTracks.delete(track);
		}
	}
	yield* visit(0);
}

function productKey(
	domains: readonly TrackAssignmentDomain[],
	allocations: readonly RoutingTrackAllocation[],
): string {
	return JSON.stringify(
		domains.map((domain, index) => [domain.id, assignmentKey(domain, defined(allocations[index]))]),
	);
}

/** Products are lazy; the historical product is first and is not repeated among alternatives. */
export function* trackAllocationProducts(
	domains: readonly TrackAssignmentDomain[],
): Generator<TrackAllocationProduct> {
	const baseline = domains.map(baselineFor);
	const baselineKey = productKey(domains, baseline);
	yield { allocations: baseline, key: baselineKey };

	const selected: RoutingTrackAllocation[] = [];
	function* extend(index: number): Generator<TrackAllocationProduct> {
		if (index === domains.length) {
			const allocations = [...selected];
			const key = productKey(domains, allocations);
			if (key !== baselineKey) yield { allocations, key };
			return;
		}
		for (const allocation of assignments(defined(domains[index]))) {
			selected.push(allocation);
			yield* extend(index + 1);
			selected.pop();
		}
	}
	yield* extend(0);
}
