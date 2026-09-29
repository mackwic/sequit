import { defined } from '../../document/logic-document';
import { type Interval, transverseEnvelope } from '../geometry/envelope';
import { type MutableBounds, translateTransversely } from '../geometry/layout-frame';
import type { BranchAnchor } from '../structure/branch-anchors';
import { fitRowAnchors, type RowAnchorItem } from './fit-row-anchors';

export interface BranchAlignment {
	readonly anchors: ReadonlyMap<string, BranchAnchor>;
	readonly offsets?: ReadonlyMap<string, number> | undefined;
}

/** The graph relations families follow, independent of any one row. */
export interface FamilyAdjacency {
	/** Outgoing adjacency: an endpoint's parents sit in the previous row. */
	readonly parents: ReadonlyMap<string, readonly string[]>;
	/** Incoming adjacency: an endpoint's children sit in the next row. */
	readonly children: ReadonlyMap<string, readonly string[]>;
	/** Direct container of an endpoint; undefined at the root. */
	readonly containerOf: (id: string) => string | undefined;
}

export interface FamilyAlignmentInput {
	readonly rows: readonly (readonly string[])[];
	readonly adjacency: FamilyAdjacency;
	/** Junctions are transparent: a family continues through their rails. */
	readonly junctionIds: ReadonlySet<string>;
	readonly bounds: Map<string, MutableBounds>;
	readonly vertical: boolean;
	readonly alignment?: BranchAlignment | undefined;
}

/** Consecutive row members sharing exactly the same related endpoints in the neighbor row. */
interface Family {
	readonly members: string[];
	readonly related: readonly string[];
	/** A member related across containers stays put, as a wall for its neighbors. */
	readonly fixed: boolean;
}

/** Families of every row, toward the previous row (down) and toward the next row (up). */
interface FamilyPlan {
	readonly parents: ReadonlyMap<string, readonly string[]>;
	readonly down: readonly (readonly Family[])[];
	readonly up: readonly (readonly Family[])[];
}

interface PlanPass {
	readonly input: FamilyAlignmentInput;
	readonly edges: ReadonlyMap<string, readonly string[]>;
	readonly rowOf: ReadonlyMap<string, number>;
	readonly neighborRank: number;
}

/** Rows and adjacency are fixed for a prepared structure; only bounds change between calls. */
const plans = new WeakMap<readonly (readonly string[])[], FamilyPlan>();

/** Related endpoints in the neighbor row, looking through junctions only when there are any. */
function relatedAcrossJunctions(id: string, pass: PlanPass): readonly string[] {
	const { edges, rowOf, neighborRank, input } = pass;
	const direct = edges.get(id) ?? [];
	if (!direct.some((next) => input.junctionIds.has(next)))
		return direct.filter((next) => rowOf.get(next) === neighborRank);
	const found = new Set<string>();
	const seen = new Set<string>();
	const pending = [...direct];
	for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
		if (seen.has(next)) continue;
		seen.add(next);
		if (rowOf.get(next) === neighborRank) found.add(next);
		else if (input.junctionIds.has(next)) pending.push(...(edges.get(next) ?? []));
	}
	return [...found];
}

/** Identical adjacency lists are the common case; parallel relations may repeat an endpoint. */
function sameMembers(left: readonly string[], right: readonly string[]): boolean {
	if (left.length === right.length && left.every((id, index) => id === right[index])) return true;
	const leftSet = new Set(left);
	const rightSet = new Set(right);
	if (leftSet.size !== rightSet.size) return false;
	for (const id of leftSet) if (!rightSet.has(id)) return false;
	return true;
}

/**
 * A family only follows related endpoints of its own container: aligning across containers
 * would fight the separation of their group envelopes.
 */
function sameContainer(id: string, related: readonly string[], input: FamilyAlignmentInput) {
	const { containerOf } = input.adjacency;
	const container = containerOf(id);
	return related.every((other) => containerOf(other) === container);
}

function rowFamilies(row: readonly string[], pass: PlanPass): readonly Family[] {
	const result: Family[] = [];
	for (const id of row) {
		const related = relatedAcrossJunctions(id, pass);
		if (!sameContainer(id, related, pass.input)) {
			result.push({ members: [id], related: [], fixed: true });
			continue;
		}
		const previous = result.at(-1);
		const open = previous !== undefined && !previous.fixed;
		const joins = open && related.length > 0;
		if (joins && sameMembers(previous.related, related)) previous.members.push(id);
		else result.push({ members: [id], related, fixed: false });
	}
	return result;
}

function familyPlan(input: FamilyAlignmentInput): FamilyPlan {
	const cached = plans.get(input.rows);
	if (cached?.parents === input.adjacency.parents) return cached;
	const rowOf = new Map<string, number>();
	for (const [rank, row] of input.rows.entries()) for (const id of row) rowOf.set(id, rank);
	const { parents, children } = input.adjacency;
	const plan = {
		parents,
		down: input.rows.map((row, rank) =>
			rowFamilies(row, { input, edges: parents, rowOf, neighborRank: rank - 1 }),
		),
		up: input.rows.map((row, rank) =>
			rowFamilies(row, { input, edges: children, rowOf, neighborRank: rank + 1 }),
		),
	};
	plans.set(input.rows, plan);
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
	const target = center(related) + portOffset(family, input, sign);
	return { center: ownCenter, size, fixed: family.fixed, target };
}

/**
 * Center each family on the envelope of its related endpoints, moving families as rigid
 * blocks. The row order and the minimum gaps are preserved; the row may grow.
 */
function alignRow(families: readonly Family[], input: FamilyAlignmentInput, sign: 1 | -1): void {
	const items = families.map((family) => familyItem(family, input, sign));
	let centers: readonly number[];
	const [single] = items;
	const alone = items.length === 1 && single !== undefined;
	if (alone && !single.fixed) centers = [single.target ?? single.center];
	else centers = fitRowAnchors(items);
	for (const [index, family] of families.entries()) {
		const shift = defined(centers[index]) - defined(items[index]).center;
		if (shift === 0) continue;
		for (const id of family.members)
			translateTransversely(defined(input.bounds.get(id)), shift, input.vertical);
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
