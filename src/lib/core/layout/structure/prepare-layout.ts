import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { orderEndpoints } from '../../ordering/endpoint-order';
import { type BranchAnchor, branchAnchors } from './branch-anchors';
import { type GroupHierarchy, prepareGroupHierarchy } from './group-hierarchy';
import { type JunctionPlacement, prepareJunctions } from './junction-structure';
import { containmentComponents, weaklyConnectedComponents } from './layout-components';
import { preparePlacementRows, type RankedComponent } from './placement-rows';

export interface LayoutStructure {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly maximumRank: number;
	readonly junctionIds: ReadonlySet<string>;
	readonly junctions: ReadonlyMap<string, JunctionPlacement>;
	readonly branchAnchors: ReadonlyMap<string, BranchAnchor>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly components: readonly RankedComponent[];
	readonly containment: readonly (readonly string[])[] | undefined;
	readonly groupSeparationCandidates: readonly GroupSeparationCandidate[] | undefined;
}

export interface GroupSeparationCandidate {
	readonly groupId: string;
	readonly nodeIds: readonly string[];
}

interface RankRange {
	readonly start: number;
	readonly end: number;
}

interface GroupMembershipRange {
	readonly start: number;
	readonly end: number;
}

function componentContext(
	graph: LogicGraph,
	ids: readonly string[],
	hierarchy: GroupHierarchy | undefined,
): string {
	const contexts = new Set<string>();
	for (const id of ids) {
		const groupId = graph.endpointsById.get(id)?.entity.groupId;
		let context = '~root';
		if (groupId !== undefined) context = defined(hierarchy?.rootById.get(groupId));
		contexts.add(context);
	}
	return [...contexts].sort(compareCanonicalStrings).join('|');
}

function packingOrder(
	components: readonly RankedComponent[],
	hierarchy: GroupHierarchy,
): readonly string[] {
	const ids = new Set<string>();
	for (const component of components) {
		for (const row of component.rows.ordinary) for (const id of row) ids.add(id);
		for (const row of component.rows.junction) for (const id of row) ids.add(id);
	}
	for (const group of hierarchy.deepestFirst) ids.add(group.id);
	return [...ids];
}

interface RankedNode {
	readonly id: string;
	readonly rank: number;
	readonly membershipIndex: number;
}

interface RankedNodeIndex {
	readonly nodes: readonly RankedNode[];
	readonly treeSize: number;
	readonly minimumMembership: readonly number[];
	readonly maximumMembership: readonly number[];
}

function groupRankRanges(
	hierarchy: GroupHierarchy,
	ranks: ReadonlyMap<string, number>,
): ReadonlyMap<string, RankRange> {
	const rankRanges = new Map<string, RankRange>();
	for (const group of hierarchy.deepestFirst) {
		let start = Number.POSITIVE_INFINITY;
		let end = Number.NEGATIVE_INFINITY;
		for (const memberId of hierarchy.membersById.get(group.id) ?? []) {
			const memberRange = rankRanges.get(memberId);
			if (memberRange !== undefined) {
				start = Math.min(start, memberRange.start);
				end = Math.max(end, memberRange.end);
				continue;
			}
			const rank = ranks.get(memberId);
			if (rank === undefined) continue;
			start = Math.min(start, rank);
			end = Math.max(end, rank);
		}
		if (start === Number.POSITIVE_INFINITY) continue;
		rankRanges.set(group.id, { start, end });
	}
	return rankRanges;
}

function rankBoundary(nodes: readonly RankedNode[], rank: number, includeEqual: boolean): number {
	let low = 0;
	let high = nodes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		const nodeRank = defined(nodes[middle]).rank;
		let beforeBoundary = nodeRank < rank;
		if (includeEqual && nodeRank === rank) beforeBoundary = true;
		if (beforeBoundary) low = middle + 1;
		else high = middle;
	}
	return low;
}

function rankedNodeIndex(
	graph: LogicGraph,
	ranks: ReadonlyMap<string, number>,
	hierarchy: GroupHierarchy,
): RankedNodeIndex | undefined {
	const nodes: RankedNode[] = [];
	for (const node of graph.document.nodes) {
		const rank = ranks.get(node.id);
		if (rank === undefined) continue;
		let membershipIndex = -1;
		if (node.groupId !== undefined)
			membershipIndex = hierarchy.preorderIndexById.get(node.groupId) ?? -1;
		nodes.push({ id: node.id, rank, membershipIndex });
	}
	if (nodes.length === 0) return undefined;
	nodes.sort((left, right) => left.rank - right.rank || compareCanonicalStrings(left.id, right.id));
	let treeSize = 1;
	while (treeSize < nodes.length) treeSize *= 2;
	const minimumMembership = new Array<number>(treeSize * 2).fill(Number.POSITIVE_INFINITY);
	const maximumMembership = new Array<number>(treeSize * 2).fill(Number.NEGATIVE_INFINITY);
	for (const [index, node] of nodes.entries()) {
		minimumMembership[treeSize + index] = node.membershipIndex;
		maximumMembership[treeSize + index] = node.membershipIndex;
	}
	for (let index = treeSize - 1; index > 0; index -= 1) {
		const leftChild = index * 2;
		const rightChild = leftChild + 1;
		minimumMembership[index] = Math.min(
			defined(minimumMembership[leftChild]),
			defined(minimumMembership[rightChild]),
		);
		maximumMembership[index] = Math.max(
			defined(maximumMembership[leftChild]),
			defined(maximumMembership[rightChild]),
		);
	}
	return { nodes, treeSize, minimumMembership, maximumMembership };
}

function segmentContainsOnlyMembers(
	index: number,
	range: GroupMembershipRange,
	nodeIndex: RankedNodeIndex,
): boolean {
	const minimum = defined(nodeIndex.minimumMembership[index]);
	const maximum = defined(nodeIndex.maximumMembership[index]);
	if (minimum < range.start) return false;
	if (maximum > range.end) return false;
	return true;
}

function membershipOutsideGroup(node: RankedNode, range: GroupMembershipRange): boolean {
	if (node.membershipIndex < range.start) return true;
	return node.membershipIndex > range.end;
}

function appendOutsideGroupNodes(
	index: number,
	range: GroupMembershipRange,
	nodeIndex: RankedNodeIndex,
	nodeIds: string[],
): void {
	if (segmentContainsOnlyMembers(index, range, nodeIndex)) return;
	if (index >= nodeIndex.treeSize) {
		const node = nodeIndex.nodes[index - nodeIndex.treeSize];
		if (node === undefined) return;
		if (membershipOutsideGroup(node, range)) nodeIds.push(node.id);
		return;
	}
	appendOutsideGroupNodes(index * 2, range, nodeIndex, nodeIds);
	appendOutsideGroupNodes(index * 2 + 1, range, nodeIndex, nodeIds);
}

function outsideGroupNodesInRankRange(
	range: RankRange,
	membershipRange: GroupMembershipRange,
	nodeIndex: RankedNodeIndex,
): string[] {
	const leftBoundary = rankBoundary(nodeIndex.nodes, range.start, false);
	const rightBoundary = rankBoundary(nodeIndex.nodes, range.end, true);
	let left = leftBoundary + nodeIndex.treeSize;
	let right = rightBoundary + nodeIndex.treeSize;
	const segmentIndices: number[] = [];
	while (left < right) {
		if (left % 2 === 1) segmentIndices.push(left++);
		if (right % 2 === 1) segmentIndices.push(--right);
		left >>>= 1;
		right >>>= 1;
	}
	const nodeIds: string[] = [];
	for (const index of segmentIndices)
		appendOutsideGroupNodes(index, membershipRange, nodeIndex, nodeIds);
	return nodeIds;
}

function groupSeparationCandidate(
	groupId: string,
	rankRanges: ReadonlyMap<string, RankRange>,
	hierarchy: GroupHierarchy,
	nodeIndex: RankedNodeIndex,
): GroupSeparationCandidate | undefined {
	const rankRange = rankRanges.get(groupId);
	if (rankRange === undefined) return undefined;
	const subtreeStart = hierarchy.preorderIndexById.get(groupId);
	if (subtreeStart === undefined) return undefined;
	const subtreeEnd = hierarchy.subtreeEndById.get(groupId);
	if (subtreeEnd === undefined) return undefined;
	let candidateRange = rankRange;
	if (rankRange.start === rankRange.end)
		candidateRange = { start: rankRange.start - 1, end: rankRange.end + 1 };
	const membershipRange = { start: subtreeStart, end: subtreeEnd };
	const nodeIds = outsideGroupNodesInRankRange(candidateRange, membershipRange, nodeIndex);
	if (nodeIds.length === 0) return undefined;
	nodeIds.sort(compareCanonicalStrings);
	return { groupId, nodeIds };
}

function groupSeparationCandidates(
	graph: LogicGraph,
	ranks: ReadonlyMap<string, number>,
	hierarchy: GroupHierarchy | undefined,
): readonly GroupSeparationCandidate[] | undefined {
	if (hierarchy === undefined) return undefined;
	const rankRanges = groupRankRanges(hierarchy, ranks);
	const nodeIndex = rankedNodeIndex(graph, ranks, hierarchy);
	if (nodeIndex === undefined) return undefined;
	const candidates: GroupSeparationCandidate[] = [];
	for (const group of hierarchy.deepestFirst) {
		const candidate = groupSeparationCandidate(group.id, rankRanges, hierarchy, nodeIndex);
		if (candidate !== undefined) candidates.push(candidate);
	}
	if (candidates.length === 0) return undefined;
	return candidates;
}

export function prepareLayout(graph: LogicGraph, ranks: TopologicalRanks): LayoutStructure {
	const hierarchy = prepareGroupHierarchy(graph.document);
	const maximumRank = Math.max(0, ...ranks.byEndpointId.values());
	const junctionIds = new Set(graph.document.junctions.map(({ id }) => id));
	const junctions = prepareJunctions(graph, ranks.byEndpointId);
	const placementRanks = new Map(ranks.byEndpointId);
	for (const [id, junction] of junctions) placementRanks.set(id, junction.interval);
	const endpointOrder = orderEndpoints([
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	]);
	const orderById = new Map(endpointOrder.map((id, index) => [id, index]));
	// A target-local order edit can still move a whole disconnected component. Preserving
	// this policy leaves stable component intent to a separate behavioral change.
	const components = weaklyConnectedComponents(graph).map((ids): RankedComponent => ({
		ids,
		context: componentContext(graph, ids, hierarchy),
		effectiveOrder: Math.min(
			...ids
				.filter((id) => ranks.byEndpointId.get(id) === 0)
				.map((id) => defined(orderById.get(id))),
		),
		rows: preparePlacementRows({
			ids,
			orderById,
			ranks: placementRanks,
			junctionIds,
			maximumRank,
		}),
	}));
	components.sort(
		(left, right) =>
			compareCanonicalStrings(left.context, right.context) ||
			left.effectiveOrder - right.effectiveOrder,
	);

	let containment: LayoutStructure['containment'];
	if (hierarchy !== undefined)
		containment = containmentComponents(graph, packingOrder(components, hierarchy));
	const groupSeparations = groupSeparationCandidates(graph, placementRanks, hierarchy);
	return {
		graph,
		ranks,
		maximumRank,
		junctionIds,
		junctions,
		hierarchy,
		components,
		containment,
		branchAnchors: branchAnchors(graph, ranks.byEndpointId),
		groupSeparationCandidates: groupSeparations,
	};
}
