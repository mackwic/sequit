import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicEndpoint } from '../document/logic-document';
import { orderEndpoints } from '../ordering/endpoint-order';
import { fractionalOrderKeySpace, type OrderKeySpace } from '../ordering/order-key-space';

/** Bands of endpoint identifiers sharing one rank, in the caller's band order. */
export interface RankDomain {
	readonly bands: readonly (readonly string[])[];
}

/** One full order per band of a {@link RankDomain}, in the same band order. */
export type RankOrder = readonly (readonly string[])[];

/** Coordinate-free inputs the ordering slot reads to reproduce documentary order. */
export interface RankOrderInput {
	readonly endpoints: readonly LogicEndpoint[];
	readonly keySpace?: OrderKeySpace;
}

/** The ordering slot: a rank domain and its inputs produce one order per band. */
export type RankOrderAlgorithm = (domain: RankDomain, input: RankOrderInput) => RankOrder;

/** A relation projected to its endpoints; identifiers do not enter the crossing count. */
export interface RankOrderRelation {
	readonly from: string;
	readonly to: string;
}

/** Every ordering of `values`, in stable index order; an empty list has one empty ordering. */
export function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
	if (values.length === 0) return [[]];
	return values.flatMap((value, index) =>
		permutations(values.filter((_, other) => other !== index)).map((rest) => [value, ...rest]),
	);
}

function factorial(value: number): number {
	let total = 1;
	for (let factor = 2; factor <= value; factor += 1) total *= factor;
	return total;
}

/** The product of the bands' factorial sizes: the exact number of enumerated orders. */
export function rankOrderEnumerationSize(domain: RankDomain): number {
	return domain.bands.reduce((total, band) => total * factorial(band.length), 1);
}

/**
 * The full permutation product of a domain, band by band: the first band varies slowest and the
 * last fastest, matching nested `for` loops in band order. The declared budget caps the result;
 * a domain whose product exceeds it is refused rather than silently truncated, so a caller never
 * loses a declared candidate.
 */
export function enumerateRankOrders(domain: RankDomain, budget: number): readonly RankOrder[] {
	if (!Number.isSafeInteger(budget) || budget < 0)
		throw new Error(`Rank order enumeration budget must be a non-negative safe integer: ${budget}`);
	const size = rankOrderEnumerationSize(domain);
	if (size > budget)
		throw new Error(`Rank order enumeration exceeds its budget: ${size} > ${budget}`);
	let orders: RankOrder[] = [[]];
	for (const band of domain.bands) {
		const next: RankOrder[] = [];
		for (const prefix of orders) {
			for (const permutation of permutations(band)) next.push([...prefix, permutation]);
		}
		orders = next;
	}
	return orders;
}

/**
 * Documentary order: within each band, endpoints sorted by layout order then canonical id.
 * Delegates to the engine's {@link orderEndpoints} so both share one code path.
 */
export function documentaryRankOrder(domain: RankDomain, input: RankOrderInput): RankOrder {
	const endpointsById = new Map(input.endpoints.map((endpoint) => [endpoint.id, endpoint]));
	const keySpace = input.keySpace ?? fractionalOrderKeySpace;
	return domain.bands.map((band) =>
		orderEndpoints(
			band.map((id) => defined(endpointsById.get(id))),
			keySpace,
		),
	);
}

/** Independent oracle: every band is a bijection of its domain band, with no repeated id. */
export function validateRankOrder(domain: RankDomain, order: RankOrder): boolean {
	if (order.length !== domain.bands.length) return false;
	const seen = new Set<string>();
	for (let index = 0; index < domain.bands.length; index += 1) {
		const band = defined(domain.bands[index]);
		const candidate = defined(order[index]);
		if (candidate.length !== band.length) return false;
		const members = new Set(band);
		for (const id of candidate) {
			if (!members.has(id) || seen.has(id)) return false;
			seen.add(id);
		}
	}
	return true;
}

interface CrossingIndex {
	readonly bandByEndpoint: ReadonlyMap<string, number>;
	readonly ordinalByEndpoint: ReadonlyMap<string, number>;
}

function indexRankOrder(order: RankOrder): CrossingIndex {
	const bandByEndpoint = new Map<string, number>();
	const ordinalByEndpoint = new Map<string, number>();
	for (const [bandIndex, band] of order.entries()) {
		for (const [ordinal, id] of band.entries()) {
			bandByEndpoint.set(id, bandIndex);
			ordinalByEndpoint.set(id, ordinal);
		}
	}
	return { bandByEndpoint, ordinalByEndpoint };
}

function pairCrosses(
	left: RankOrderRelation,
	right: RankOrderRelation,
	index: CrossingIndex,
): boolean {
	if (left.from === right.from || left.to === right.to) return false;
	const sourceBand = index.bandByEndpoint.get(left.from);
	if (sourceBand === undefined || sourceBand !== index.bandByEndpoint.get(right.from)) return false;
	const targetBand = index.bandByEndpoint.get(left.to);
	if (targetBand === undefined || targetBand !== index.bandByEndpoint.get(right.to)) return false;
	const sourceOrder = Math.sign(
		defined(index.ordinalByEndpoint.get(left.from)) -
			defined(index.ordinalByEndpoint.get(right.from)),
	);
	const targetOrder = Math.sign(
		defined(index.ordinalByEndpoint.get(left.to)) - defined(index.ordinalByEndpoint.get(right.to)),
	);
	return sourceOrder !== targetOrder;
}

/**
 * Independent oracle: pairwise inversions between two relations that share both their bands.
 * Coordinate-free; a pair crosses when its source and target orders disagree. Relations sharing
 * an endpoint, or living in different band pairs, cannot cross and are skipped.
 */
export function countRankOrderCrossings(
	order: RankOrder,
	relations: readonly RankOrderRelation[],
): number {
	const index = indexRankOrder(order);
	let crossings = 0;
	for (let first = 0; first < relations.length; first += 1) {
		for (let second = first + 1; second < relations.length; second += 1) {
			if (pairCrosses(defined(relations[first]), defined(relations[second]), index)) crossings += 1;
		}
	}
	return crossings;
}

/** Canonical band-by-band comparison, used to break crossing ties deterministically. */
export function compareRankOrders(left: RankOrder, right: RankOrder): number {
	const sharedBands = Math.min(left.length, right.length);
	for (let bandIndex = 0; bandIndex < sharedBands; bandIndex += 1) {
		const leftBand = defined(left[bandIndex]);
		const rightBand = defined(right[bandIndex]);
		const sharedOrdinals = Math.min(leftBand.length, rightBand.length);
		for (let ordinal = 0; ordinal < sharedOrdinals; ordinal += 1) {
			const order = compareCanonicalStrings(
				defined(leftBand[ordinal]),
				defined(rightBand[ordinal]),
			);
			if (order !== 0) return order;
		}
		if (leftBand.length !== rightBand.length) return leftBand.length - rightBand.length;
	}
	return left.length - right.length;
}
