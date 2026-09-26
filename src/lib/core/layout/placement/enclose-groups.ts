import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { envelopeOf } from '../geometry/envelope';
import {
	biasedMainStart,
	boundsOnAxes,
	type LayoutFrame,
	mainSize,
	type MutableBounds,
	translateTransversely,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { COMPONENT_GAP, OUTER_MARGIN } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import type { PackingCursor } from './pack-components';
import { packGroupSiblings } from './pack-group-siblings';

function enclosure(
	measurement: GroupMeasurement,
	members: readonly string[],
	bounds: ReadonlyMap<string, MutableBounds>,
): MutableBounds {
	const envelope = envelopeOf(members, bounds);
	const x = envelope.left - measurement.padding;
	const y = envelope.top - measurement.headerHeight - measurement.padding;
	return {
		x,
		y,
		width: Math.max(measurement.minimumWidth, envelope.right - x + measurement.padding),
		height: Math.max(measurement.minimumHeight, envelope.bottom - y + measurement.padding),
	};
}

interface NodeIndex {
	readonly leafCount: number;
	readonly minimumGroup: readonly number[];
	readonly maximumGroup: readonly number[];
	readonly minimumCross: readonly number[];
	readonly maximumCrossEnd: readonly number[];
	readonly minimumMain: readonly number[];
	readonly maximumMainEnd: readonly number[];
}

function mainStart(box: MutableBounds, vertical: boolean): number {
	if (vertical) return box.y;
	return box.x;
}

function indexNodes(
	graph: LogicGraph,
	hierarchy: GroupHierarchy,
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
): NodeIndex {
	const endpoints = [...graph.document.nodes, ...graph.document.junctions];
	const nodes = endpoints.map((node) => {
		let groupIndex = -1;
		if (node.groupId !== undefined)
			groupIndex = defined(hierarchy.preorderIndexById.get(node.groupId));
		return { id: node.id, groupIndex, bounds: defined(bounds.get(node.id)) };
	});
	nodes.sort(
		(left, right) =>
			transverseStart(left.bounds, vertical) - transverseStart(right.bounds, vertical) ||
			compareCanonicalStrings(left.id, right.id),
	);
	let leafCount = 1;
	while (leafCount < nodes.length) leafCount *= 2;
	const minimumGroup = new Array<number>(leafCount * 2).fill(Number.POSITIVE_INFINITY);
	const maximumGroup = new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY);
	const minimumCross = new Array<number>(leafCount * 2).fill(Number.POSITIVE_INFINITY);
	const maximumCrossEnd = new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY);
	const minimumMain = new Array<number>(leafCount * 2).fill(Number.POSITIVE_INFINITY);
	const maximumMainEnd = new Array<number>(leafCount * 2).fill(Number.NEGATIVE_INFINITY);
	for (const [position, node] of nodes.entries()) {
		const index = leafCount + position;
		const box = node.bounds;
		minimumGroup[index] = maximumGroup[index] = node.groupIndex;
		minimumCross[index] = transverseStart(box, vertical);
		maximumCrossEnd[index] = minimumCross[index] + transverseSize(box, vertical);
		minimumMain[index] = mainStart(box, vertical);
		maximumMainEnd[index] = minimumMain[index] + mainSize(box, vertical);
	}
	for (let index = leafCount - 1; index > 0; index -= 1) {
		const left = index * 2,
			right = left + 1;
		minimumGroup[index] = Math.min(defined(minimumGroup[left]), defined(minimumGroup[right]));
		maximumGroup[index] = Math.max(defined(maximumGroup[left]), defined(maximumGroup[right]));
		minimumCross[index] = Math.min(defined(minimumCross[left]), defined(minimumCross[right]));
		maximumCrossEnd[index] = Math.max(
			defined(maximumCrossEnd[left]),
			defined(maximumCrossEnd[right]),
		);
		minimumMain[index] = Math.min(defined(minimumMain[left]), defined(minimumMain[right]));
		maximumMainEnd[index] = Math.max(defined(maximumMainEnd[left]), defined(maximumMainEnd[right]));
	}
	return {
		leafCount,
		minimumGroup,
		maximumGroup,
		minimumCross,
		maximumCrossEnd,
		minimumMain,
		maximumMainEnd,
	};
}

interface GroupQuery {
	readonly first: number;
	readonly last: number;
	readonly crossStart: number;
	readonly crossEnd: number;
	readonly mainStart: number;
	readonly mainEnd: number;
}

function hasForeignNode(index: NodeIndex, position: number, query: GroupQuery): boolean {
	if (defined(index.minimumCross[position]) >= query.crossEnd) return false;
	if (defined(index.maximumCrossEnd[position]) <= query.crossStart) return false;
	if (defined(index.minimumMain[position]) >= query.mainEnd) return false;
	if (defined(index.maximumMainEnd[position]) <= query.mainStart) return false;
	const onlyMembers =
		defined(index.minimumGroup[position]) >= query.first &&
		defined(index.maximumGroup[position]) <= query.last;
	if (onlyMembers) return false;
	if (position >= index.leafCount) return true;
	if (hasForeignNode(index, position * 2, query)) return true;
	return hasForeignNode(index, position * 2 + 1, query);
}

/** Index each measured node once; whole descendant subtrees are pruned per group. */
function hasForeignIntersection(
	hierarchy: GroupHierarchy,
	graph: LogicGraph,
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
): boolean {
	if (graph.document.nodes.length === 0 && graph.document.junctions.length === 0) return false;
	const index = indexNodes(graph, hierarchy, bounds, vertical);
	for (const group of hierarchy.deepestFirst) {
		const box = defined(bounds.get(group.id));
		const crossStart = transverseStart(box, vertical);
		const along = mainStart(box, vertical);
		const query = {
			first: defined(hierarchy.preorderIndexById.get(group.id)),
			last: defined(hierarchy.subtreeEndById.get(group.id)),
			crossStart,
			crossEnd: crossStart + transverseSize(box, vertical),
			mainStart: along,
			mainEnd: along + mainSize(box, vertical),
		};
		if (hasForeignNode(index, 1, query)) return true;
	}
	return false;
}

/**
 * Pack disjoint sibling intervals bottom-up; translate their contents top-down once.
 * Every ancestor sees the effective measured bounds of each child, including tall
 * empty groups. No rank-window estimate or iterative cascade is necessary.
 */
export function separateInterleavedGroupNodes(input: {
	readonly hierarchy: GroupHierarchy;
	readonly graph: LogicGraph;
	readonly measurements: ReadonlyMap<string, GroupMeasurement>;
	readonly bounds: Map<string, MutableBounds>;
	readonly frame: LayoutFrame;
}): void {
	const { hierarchy, graph, measurements, bounds, frame } = input;
	if (!hasForeignIntersection(hierarchy, graph, bounds, frame.vertical)) return;
	const pending = new Map<string, number>();
	for (const group of hierarchy.deepestFirst) {
		const children = hierarchy.membersById.get(group.id) ?? [];
		if (children.length === 0) continue;
		packGroupSiblings(children, bounds, { groupIds: hierarchy.byId, pending }, frame.vertical);
		bounds.set(group.id, enclosure(defined(measurements.get(group.id)), children, bounds));
	}
	const roots = [
		...graph.document.nodes.filter((node) => node.groupId === undefined).map((node) => node.id),
		...graph.document.junctions
			.filter((junction) => junction.groupId === undefined)
			.map((junction) => junction.id),
		...graph.document.groups
			.filter((group) => group.groupId === undefined)
			.map((group) => group.id),
	];
	packGroupSiblings(roots, bounds, { groupIds: hierarchy.byId, pending }, frame.vertical);

	// Parent translations have already moved the child frame, not its contents.
	const queue = graph.document.groups
		.filter((group) => group.groupId === undefined)
		.map((group) => ({ id: group.id, inherited: 0 }));
	for (const { id, inherited } of queue) {
		const childShift = inherited + (pending.get(id) ?? 0);
		if (inherited !== 0) translateTransversely(defined(bounds.get(id)), inherited, frame.vertical);
		for (const memberId of hierarchy.membersById.get(id) ?? []) {
			if (hierarchy.byId.has(memberId)) {
				queue.push({ id: memberId, inherited: childShift });
			} else if (childShift !== 0) {
				translateTransversely(defined(bounds.get(memberId)), childShift, frame.vertical);
			}
		}
	}
}

export function encloseGroups(
	input: {
		readonly hierarchy: GroupHierarchy;
		readonly measurements: ReadonlyMap<string, GroupMeasurement>;
		readonly bounds: Map<string, MutableBounds>;
		readonly frame: LayoutFrame;
	},
	cursor: PackingCursor,
): void {
	const { hierarchy, measurements, bounds, frame } = input;
	for (const group of hierarchy.deepestFirst) {
		const measurement = defined(measurements.get(group.id));
		const members = hierarchy.membersById.get(group.id) ?? [];
		if (members.length > 0) {
			bounds.set(group.id, enclosure(measurement, members, bounds));
			continue;
		}
		if (bounds.has(group.id)) continue;
		const size = { width: measurement.minimumWidth, height: measurement.minimumHeight };
		const main =
			OUTER_MARGIN +
			biasedMainStart(mainSize(size, frame.vertical), cursor.maximumPrimaryLength, frame);
		bounds.set(group.id, boundsOnAxes(cursor.cross, main, size, frame.vertical));
		cursor.cross += transverseSize(size, frame.vertical) + COMPONENT_GAP;
	}
}
