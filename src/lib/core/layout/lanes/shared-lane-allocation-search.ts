import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import type { RoutingTrackAllocation } from '../resources/routing-resource-allocation';

/** One route band and the track assignments the selected strategy actually reads from it. */
export interface TrackAssignmentDomain {
	readonly id: string;
	readonly edge: RoutingEdge;
	readonly trackCount: number;
	/** Active allocation keys; lane plans currently use their relation IDs as keys. */
	readonly keys: readonly string[];
	readonly baseline: RoutingTrackAllocation;
}

/** One effective combination of track maps, with a stable canonical key for tie-breaking. */
export interface TrackAllocationProduct {
	readonly allocations: readonly RoutingTrackAllocation[];
	readonly key: string;
}

interface CanonicalDomain {
	readonly domain: TrackAssignmentDomain;
	readonly ids: readonly string[];
}

function canonicalDomain(domain: TrackAssignmentDomain): CanonicalDomain {
	return { domain, ids: [...domain.keys].sort(compareCanonicalStrings) };
}

function allocationFor(
	domain: TrackAssignmentDomain,
	tracks: ReadonlyMap<string, number>,
): RoutingTrackAllocation {
	return { edge: domain.edge, trackByKey: tracks };
}

function baselineFor({ domain, ids }: CanonicalDomain): RoutingTrackAllocation {
	const tracks = new Map<string, number>();
	for (const id of ids) tracks.set(id, defined(domain.baseline.trackByKey.get(id)));
	return allocationFor(domain, tracks);
}

function assignmentKey(ids: readonly string[], allocation: RoutingTrackAllocation): string {
	return JSON.stringify(ids.map((id) => [id, defined(allocation.trackByKey.get(id))]));
}

/** Exact number of injective assignments of the active routes to their used tracks. */
function trackAssignmentCount(domain: TrackAssignmentDomain): bigint {
	const { length } = domain.keys;
	let count = 1n;
	for (let index = 0; index < length; index += 1) count *= BigInt(domain.trackCount - index);
	return count;
}

/** Exact cardinality of the independent route-band product, without materializing it. */
export function trackAllocationProductCount(domains: readonly TrackAssignmentDomain[]): bigint {
	let count = 1n;
	for (const domain of domains) count *= trackAssignmentCount(domain);
	return count;
}

function firstUnusedTrack(trackCount: number, used: ReadonlySet<number>): number {
	for (let track = 0; track < trackCount; track += 1) if (!used.has(track)) return track;
	throw new Error('No free route track remains.');
}

function advanceTracks(tracks: number[], trackCount: number): boolean {
	for (let index = tracks.length - 1; index >= 0; index -= 1) {
		const used = new Set(tracks.slice(0, index));
		let track = defined(tracks[index]) + 1;
		while (track < trackCount && used.has(track)) track += 1;
		if (track >= trackCount) continue;
		tracks[index] = track;
		used.add(track);
		for (let suffix = index + 1; suffix < tracks.length; suffix += 1) {
			const next = firstUnusedTrack(trackCount, used);
			tracks[suffix] = next;
			used.add(next);
		}
		return true;
	}
	return false;
}

/** Assignments for one band: its historical map first, then canonical-ID/track-order injections. */
function* assignments(canonical: CanonicalDomain): Generator<RoutingTrackAllocation> {
	const { domain, ids } = canonical;
	const baseline = baselineFor(canonical);
	const baselineKey = assignmentKey(ids, baseline);
	yield baseline;

	const tracks = Array.from({ length: ids.length }, (_, index) => index);
	let hasNext = true;
	while (hasNext) {
		const assignment = new Map<string, number>();
		for (const [index, id] of ids.entries()) assignment.set(id, defined(tracks[index]));
		const candidate = allocationFor(domain, assignment);
		if (assignmentKey(ids, candidate) !== baselineKey) yield candidate;
		hasNext = advanceTracks(tracks, domain.trackCount);
	}
}

function productKey(
	domains: readonly CanonicalDomain[],
	allocations: readonly RoutingTrackAllocation[],
): string {
	return JSON.stringify(
		domains.map((domain, index) => [
			domain.domain.id,
			assignmentKey(domain.ids, defined(allocations[index])),
		]),
	);
}

/** Products are lazy; the historical product is first and is not repeated among alternatives. */
export function* trackAllocationProducts(
	domains: readonly TrackAssignmentDomain[],
): Generator<TrackAllocationProduct, undefined, void> {
	const canonical = domains.map(canonicalDomain);
	const baseline = canonical.map(baselineFor);
	const baselineKey = productKey(canonical, baseline);
	yield { allocations: baseline, key: baselineKey };

	const selected: RoutingTrackAllocation[] = [];
	function* extend(index: number): Generator<TrackAllocationProduct> {
		if (index === domains.length) {
			const allocations = [...selected];
			const key = productKey(canonical, allocations);
			if (key !== baselineKey) yield { allocations, key };
			return;
		}
		for (const allocation of assignments(defined(canonical[index]))) {
			selected.push(allocation);
			yield* extend(index + 1);
			selected.pop();
		}
	}
	yield* extend(0);
}
