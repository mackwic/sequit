import { defined } from '../../document/logic-document';
import { type Interval, transverseEnvelope } from '../geometry/envelope';
import { type MutableBounds, translateTransversely } from '../geometry/layout-frame';
import type { BranchAnchor } from '../structure/branch-anchors';
import { fitRowAnchors, type RowAnchorItem } from './fit-row-anchors';

export interface BranchAlignment {
	readonly anchors: ReadonlyMap<string, BranchAnchor>;
	readonly offsets?: ReadonlyMap<string, number> | undefined;
}

/** Related endpoints of each row item, by rank: parents in the previous row, children in the next. */
export interface FamilyLinks {
	readonly down: readonly ReadonlyMap<string, readonly string[]>[];
	readonly up: readonly ReadonlyMap<string, readonly string[]>[];
	/** Endpoints inside a block item carrying its links to the next row; the block centers them. */
	readonly upAnchors?: readonly ReadonlyMap<string, readonly string[]>[] | undefined;
}

interface MutableBoundsLookup {
	get(id: string): MutableBounds | undefined;
}

export interface FamilyAlignmentInput {
	/** Row items by rank: endpoints, or blocks standing for a whole group. */
	readonly rows: readonly (readonly string[])[];
	readonly links: FamilyLinks;
	/** Current bounds by id; only reads are needed when `move` is given. */
	readonly bounds: MutableBoundsLookup;
	readonly vertical: boolean;
	readonly alignment?: BranchAlignment | undefined;
	/** A multi-row item stays put in a row, as a wall for its neighbors. */
	readonly isWall?: ((item: string, rank: number, sign: 1 | -1) => boolean) | undefined;
	/** Moves an item rigidly; a block carries its whole content. */
	readonly move?: ((item: string, shift: number) => void) | undefined;
	/** Free space between two neighbor items; the item gap by default. */
	readonly gapBetween?: ((left: string, right: string) => number) | undefined;
}

/** Consecutive row items sharing exactly the same related endpoints in the neighbor row. */
interface Family {
	readonly members: string[];
	readonly related: readonly string[];
	readonly fixed: boolean;
	/** Endpoints centered on the related ones; the members themselves by default. */
	readonly anchors?: string[] | undefined;
}

/** Families of every row, toward the previous row (down) and toward the next row (up). */
interface FamilyPlan {
	readonly down: readonly (readonly Family[])[];
	readonly up: readonly (readonly Family[])[];
}

/** Rows and links are fixed for a prepared structure; only bounds change between calls. */
const plans = new WeakMap<FamilyLinks, FamilyPlan>();

/** Identical adjacency lists are the common case; parallel relations may repeat an endpoint. */
function sameMembers(left: readonly string[], right: readonly string[]): boolean {
	if (left.length === right.length && left.every((id, index) => id === right[index])) return true;
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	if (leftSet.size !== rightSet.size) return false;
	for (const id of leftSet) if (!rightSet.has(id)) return false;
	return true;
}

function rowFamilies(
	input: FamilyAlignmentInput,
	rank: number,
	sign: 1 | -1,
	links: ReadonlyMap<string, readonly string[]> | undefined,
): readonly Family[] {
	const result: Family[] = [];
	for (const id of defined(input.rows[rank])) {
		if (input.isWall?.(id, rank, sign) === true) {
			result.push({ members: [id], related: [], fixed: true });
			continue;
		}
		const related = links?.get(id) ?? [];
		let anchors: readonly string[] = [id];
		if (sign < 0) anchors = input.links.upAnchors?.[rank]?.get(id) ?? anchors;
		const previous = result.at(-1);
		const open = previous !== undefined && !previous.fixed;
		const joins = open && related.length > 0;
		if (joins && sameMembers(previous.related, related)) {
			previous.members.push(id);
			previous.anchors?.push(...anchors);
		} else result.push({ members: [id], related, fixed: false, anchors: [...anchors] });
	}
	return result;
}

function familyPlan(input: FamilyAlignmentInput): FamilyPlan {
	const cached = plans.get(input.links);
	if (cached !== undefined) return cached;
	const plan = {
		down: input.rows.map((_, rank) => rowFamilies(input, rank, 1, input.links.down[rank])),
		up: input.rows.map((_, rank) => rowFamilies(input, rank, -1, input.links.up[rank])),
	};
	plans.set(input.links, plan);
	return plan;
}

function center(interval: Interval): number {
	return (interval.start + interval.end) / 2;
}

/** A lone member follows its single related endpoint's actual port, not only its center. */
function portOffset(family: Family, input: FamilyAlignmentInput, sign: 1 | -1): number {
	const { alignment } = input;
	if (alignment === undefined) return 0;
	if (family.members.length !== 1 || family.related.length !== 1) return 0;
	let child = defined(family.members[0]);
	let parent = defined(family.related[0]);
	if (sign < 0) {
		child = parent;
		parent = defined(family.members[0]);
	}
	if (alignment.anchors.get(child)?.parentId !== parent) return 0;
	return sign * (alignment.offsets?.get(child) ?? 0);
}

function familyItem(family: Family, input: FamilyAlignmentInput, sign: 1 | -1): RowAnchorItem {
	const { bounds, vertical } = input;
	const own = transverseEnvelope(family.members, bounds, vertical);
	const ownCenter = center(own);
	const size = own.end - own.start;
	if (family.related.length === 0) return { center: ownCenter, size, fixed: family.fixed };
	const related = transverseEnvelope(family.related, bounds, vertical);
	// A block moves so that the endpoints it holds, not its frame, face the related ones.
	const anchored = center(transverseEnvelope(family.anchors ?? family.members, bounds, vertical));
	const offset = ownCenter - anchored;
	const target = center(related) + portOffset(family, input, sign) + offset;
	return { center: ownCenter, size, fixed: family.fixed, target };
}

/**
 * Center each family on the envelope of its related endpoints, moving families as rigid
 * blocks. The row order and the minimum gaps are preserved; the row may grow.
 */
function alignRow(families: readonly Family[], input: FamilyAlignmentInput, sign: 1 | -1): void {
	const items = families.map((family, index) => {
		const item = familyItem(family, input, sign);
		const previous = families[index - 1]?.members.at(-1);
		const first = defined(family.members[0]);
		if (previous === undefined || input.gapBetween === undefined) return item;
		return { ...item, gap: input.gapBetween(previous, first) };
	});
	let centers: readonly number[];
	const [single] = items;
	const alone = items.length === 1 && single !== undefined;
	if (alone && !single.fixed) centers = [single.target ?? single.center];
	else centers = fitRowAnchors(items);
	for (const [index, family] of families.entries()) {
		const shift = defined(centers[index]) - defined(items[index]).center;
		if (shift === 0) continue;
		for (const id of family.members) {
			if (input.move === undefined)
				translateTransversely(defined(input.bounds.get(id)), shift, input.vertical);
			else input.move(id, shift);
		}
	}
}

function sweep(input: FamilyAlignmentInput, plan: FamilyPlan, direction: 1 | -1): void {
	let rows = plan.down;
	let rank = 1;
	if (direction < 0) {
		rows = plan.up;
		rank = rows.length - 2;
	}
	for (; rank >= 0 && rank < rows.length; rank += direction) {
		const families = defined(rows[rank]);
		if (families.some(({ related }) => related.length > 0)) alignRow(families, input, direction);
	}
}

/**
 * Center the transverse envelope of every family of children on its parents. A downward
 * pass centers children, an upward pass makes room for wide families beneath their parents,
 * and a final downward pass gives children the last word.
 */
export function alignFamilies(input: FamilyAlignmentInput): void {
	const plan = familyPlan(input);
	sweep(input, plan, 1);
	sweep(input, plan, -1);
	sweep(input, plan, 1);
}

interface LinkPass {
	readonly edges: ReadonlyMap<string, readonly string[]>;
	readonly junctionIds: ReadonlySet<string>;
	readonly rowOf: ReadonlyMap<string, number>;
	readonly neighborRank: number;
}

/** Related endpoints in the neighbor row, looking through junctions only when there are any. */
function relatedAcrossJunctions(id: string, pass: LinkPass): readonly string[] {
	const { edges, rowOf, neighborRank, junctionIds } = pass;
	const direct = edges.get(id) ?? [];
	if (!direct.some((next) => junctionIds.has(next)))
		return direct.filter((next) => rowOf.get(next) === neighborRank);
	const found = new Set<string>();
	const seen = new Set<string>();
	const pending = [...direct];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		if (rowOf.get(next) === neighborRank) found.add(next);
		else if (junctionIds.has(next)) pending.push(...(edges.get(next) ?? []));
	}
	return [...found];
}

/** Links of flat rows, every endpoint its own item: families follow direct relations. */
export function flatFamilyLinks(input: {
	readonly rows: readonly (readonly string[])[];
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly children: ReadonlyMap<string, readonly string[]>;
	readonly junctionIds: ReadonlySet<string>;
}): FamilyLinks {
	const rowOf = new Map<string, number>();
	for (const [rank, row] of input.rows.entries()) for (const id of row) rowOf.set(id, rank);
	const { junctionIds } = input;
	const collect = (edges: ReadonlyMap<string, readonly string[]>, offset: number) =>
		input.rows.map((row, rank) => {
			const pass = { edges, junctionIds, rowOf, neighborRank: rank + offset };
			const links = new Map<string, readonly string[]>();
			for (const id of row) links.set(id, relatedAcrossJunctions(id, pass));
			return links;
		});
	return { down: collect(input.parents, -1), up: collect(input.children, 1) };
}
