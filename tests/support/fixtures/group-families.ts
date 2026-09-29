import type { LayoutDirection } from '../../../src/lib/core/document/logic-document';
import type { VisualGraphData } from '../builders/visual-graph-builder';
import { graphFixtures } from './graph-fixtures';

type Groups = Readonly<Record<string, readonly string[]>>;

/** A graph with its group memberships; unlisted endpoints stay at the root. */
export interface GroupedGraph {
	readonly data: VisualGraphData;
	readonly groups: Groups;
}

const CONTENT = 120;

/**
 * A three-rank group beside a root family: P points into the group, its children share the
 * group's last rank and its grandchildren lie beneath the group.
 */
export function familyBesideGroup(direction: LayoutDirection, grouped = true): GroupedGraph {
	const data = graphFixtures
		.routingNodes(
			['g1', 'g2', 'g3', 'g4', 'p', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'd4', 'd5'],
			direction,
			CONTENT,
		)
		.arrowsFrom('g2', ['g1'])
		.arrowsFrom('g3', ['g2'])
		.arrowsFrom('g4', ['g2'])
		.arrowsFrom('p', ['g1'])
		.arrowsFrom('c1', ['p'])
		.arrowsFrom('c2', ['p'])
		.arrowsFrom('c3', ['p'])
		.arrowsFrom('d1', ['c1'])
		.arrowsFrom('d2', ['c1'])
		.arrowsFrom('d3', ['c2'])
		.arrowsFrom('d4', ['c3'])
		.arrowsFrom('d5', ['c3'])
		.build();
	if (!grouped) return { data, groups: {} };
	return { data, groups: { g: ['g1', 'g2', 'g3', 'g4'] } };
}

/** Four unrelated members form a wide group; two root children point to its last member only. */
export function familyBeneathMember(direction: LayoutDirection): GroupedGraph {
	const data = graphFixtures
		.routingNodes(['w1', 'w2', 'w3', 'w4', 'k1', 'k2'], direction, CONTENT)
		.arrowsFrom('k1', ['w4'])
		.arrowsFrom('k2', ['w4'])
		.build();
	return { data, groups: { w: ['w1', 'w2', 'w3', 'w4'] } };
}

/**
 * Three chains under a common root T: L and R at the root level, M inside a two-rank group
 * with its own parent M0. Each parent L, M, R has two children outside the group.
 */
export function familiesAroundGroup(direction: LayoutDirection): GroupedGraph {
	const data = graphFixtures
		.routingNodes(
			['t', 'l0', 'm0', 'r0', 'l', 'm', 'r', 'l1', 'l2', 'm1', 'm2', 'r1', 'r2'],
			direction,
			CONTENT,
		)
		.arrowsFrom('l0', ['t'])
		.arrowsFrom('m0', ['t'])
		.arrowsFrom('r0', ['t'])
		.arrowsFrom('l', ['l0'])
		.arrowsFrom('m', ['m0'])
		.arrowsFrom('r', ['r0'])
		.arrowsFrom('l1', ['l'])
		.arrowsFrom('l2', ['l'])
		.arrowsFrom('m1', ['m'])
		.arrowsFrom('m2', ['m'])
		.arrowsFrom('r1', ['r'])
		.arrowsFrom('r2', ['r'])
		.build();
	return { data, groups: { g: ['m0', 'm'] } };
}

/** A root parent whose middle child lies in a two-rank group, between two root siblings. */
export function familySplitByGroup(direction: LayoutDirection): GroupedGraph {
	const data = graphFixtures
		.routingNodes(['p', 'a', 'b', 'c', 'b1'], direction, CONTENT)
		.arrowsFrom('a', ['p'])
		.arrowsFrom('b', ['p'])
		.arrowsFrom('c', ['p'])
		.arrowsFrom('b1', ['b'])
		.build();
	return { data, groups: { g: ['b', 'b1'] } };
}
