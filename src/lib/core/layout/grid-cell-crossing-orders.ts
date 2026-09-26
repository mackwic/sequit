import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';

/** Empty routing track owned by an edge but unused by a relation. */
export const FREE_TRACK = '';

function* permutations<T>(values: readonly T[]): Generator<readonly T[]> {
	if (values.length === 0) {
		yield [];
		return;
	}
	const seen = new Set<T>();
	for (const [index, value] of values.entries()) {
		if (seen.has(value)) continue;
		seen.add(value);
		const rest = [...values.slice(0, index), ...values.slice(index + 1)];
		for (const tail of permutations(rest)) yield [value, ...tail];
	}
}

function frozenTracks(
	active: ReadonlySet<string>,
	baseline: readonly string[],
): ReadonlyMap<number, string> {
	const frozen = new Map<number, string>();
	for (const [index, id] of baseline.entries()) {
		if (id === FREE_TRACK || active.has(id)) continue;
		frozen.set(index, id);
	}
	return frozen;
}

/** Every assignment of the identifiers onto `trackCount` tracks, in lexicographic order. */
export function* trackOrders(
	ids: readonly string[],
	trackCount: number,
	active?: ReadonlySet<string>,
	baseline?: readonly string[],
): Generator<readonly string[]> {
	if (active !== undefined && baseline !== undefined) {
		const frozen = frozenTracks(active, baseline);
		const positions = Array.from({ length: trackCount }, (_, index) => index).filter(
			(index) => !frozen.has(index),
		);
		const movable = ids.filter((id) => active.has(id));
		const slots = [
			...movable,
			...Array<string>(positions.length - movable.length).fill(FREE_TRACK),
		];
		for (const order of permutations(slots.sort(compareCanonicalStrings))) {
			const result = Array<string>(trackCount).fill(FREE_TRACK);
			for (const [index, id] of frozen) result[index] = id;
			for (const [index, position] of positions.entries()) result[position] = defined(order[index]);
			yield result;
		}
		return;
	}
	const slots = [...ids, ...Array<string>(trackCount - ids.length).fill(FREE_TRACK)];
	yield* permutations([...slots].sort(compareCanonicalStrings));
}

export function* preferredTrackOrders(
	ids: readonly string[],
	trackCount: number,
	active?: ReadonlySet<string>,
	baseline?: readonly string[],
): Generator<readonly string[]> {
	yield ids;
	for (const order of trackOrders(ids, trackCount, active, baseline)) {
		if (order.some((id, index) => id !== ids[index])) yield order;
	}
}

export function* portOrders(
	incidence: ReadonlyMap<string, readonly string[]>,
	active?: ReadonlySet<string>,
): Generator<ReadonlyMap<string, readonly string[]>> {
	const entries = [...incidence].sort(([left], [right]) => compareCanonicalStrings(left, right));
	yield* combinePortOrders(entries, 0, new Map(), active);
}

function* combinePortOrders(
	entries: readonly (readonly [string, readonly string[]])[],
	index: number,
	prefix: Map<string, readonly string[]>,
	active?: ReadonlySet<string>,
): Generator<ReadonlyMap<string, readonly string[]>> {
	const entry = entries[index];
	if (entry === undefined) {
		yield new Map(prefix);
		return;
	}
	for (const order of permutations(entry[1])) {
		if (
			active !== undefined &&
			entry[1].some((id, position) => !active.has(id) && order[position] !== id)
		)
			continue;
		prefix.set(entry[0], order);
		yield* combinePortOrders(entries, index + 1, prefix, active);
	}
}
