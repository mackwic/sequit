import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';

interface OrderedEntity {
	readonly id: string;
	readonly layoutOrder: string;
}

interface OrderedRelation {
	readonly relation: LogicRelation;
	readonly source: { readonly entity: OrderedEntity };
	readonly target: { readonly entity: OrderedEntity };
}

/** For each relation array, the index of each relation in it, in relation id order. */
const idOrderByRelations = new WeakMap<readonly OrderedRelation[], readonly number[]>();

/** A stable counting sort of `order` by small integer `keys`. */
function sortedByKey(keys: Int32Array, order: Int32Array, bucketCount: number): Int32Array {
	const starts = new Int32Array(bucketCount + 1);
	for (const index of order) {
		const bucket = defined(keys[index]) + 1;
		starts[bucket] = defined(starts[bucket]) + 1;
	}
	for (let bucket = 1; bucket <= bucketCount; bucket += 1)
		starts[bucket] = defined(starts[bucket]) + defined(starts[bucket - 1]);
	const sorted = new Int32Array(order.length);
	for (const index of order) {
		const bucket = defined(keys[index]);
		const at = defined(starts[bucket]);
		sorted[at] = index;
		starts[bucket] = at + 1;
	}
	return sorted;
}

/**
 * Relations carry no order of their own: they follow the documentary order of their source, then
 * of their target (layout order, then endpoint id), so that renaming a relation never moves it.
 * `byId` is sorted by relation id, and both stable passes keep that order for parallel relations,
 * the only ones it still decides. Linear in the relations and endpoints.
 */
export function documentaryRelations<Relation extends OrderedRelation>(
	byId: readonly Relation[],
	endpoints: readonly OrderedEntity[],
): Relation[] {
	const positions = new Map(
		[...endpoints]
			.sort(
				(left, right) =>
					compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
					compareCanonicalStrings(left.id, right.id),
			)
			.map(({ id }, index) => [id, index]),
	);
	const sources = new Int32Array(byId.length);
	const targets = new Int32Array(byId.length);
	for (const [index, { source, target }] of byId.entries()) {
		sources[index] = defined(positions.get(source.entity.id));
		targets[index] = defined(positions.get(target.entity.id));
	}
	const identity = Int32Array.from({ length: byId.length }, (_, index) => index);
	const byTarget = sortedByKey(targets, identity, positions.size);
	const order = sortedByKey(sources, byTarget, positions.size);
	const idOrder = new Array<number>(byId.length);
	for (const [position, index] of order.entries()) idOrder[index] = position;
	const relations = Array.from(order, (index) => defined(byId[index]));
	idOrderByRelations.set(relations, idOrder);
	return relations;
}

/**
 * The index in `relations` of each relation, in relation id order: the order of the public
 * result. Known for the relations of a graph; any other relation array is sorted once.
 */
export function relationIndexesInIdOrder(relations: readonly OrderedRelation[]): readonly number[] {
	const cached = idOrderByRelations.get(relations);
	if (cached !== undefined) return cached;
	const id = (index: number) => defined(relations[index]).relation.id;
	const order = Array.from({ length: relations.length }, (_, index) => index);
	order.sort((left, right) => compareCanonicalStrings(id(left), id(right)));
	idOrderByRelations.set(relations, order);
	return order;
}
