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
import type { GroupSeparationCandidate } from '../structure/prepare-layout';
import type { PackingCursor } from './pack-components';

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

interface SeparationInterval {
	readonly start: number;
	readonly end: number;
}

interface SeparationContext {
	readonly hierarchy: GroupHierarchy;
	readonly graph: LogicGraph;
	readonly bounds: Map<string, MutableBounds>;
}

function mainStart(bounds: Readonly<MutableBounds>, vertical: boolean): number {
	if (vertical) return bounds.y;
	return bounds.x;
}

function overlapsMainAxes(
	left: Readonly<MutableBounds>,
	right: Readonly<MutableBounds>,
	vertical: boolean,
): boolean {
	const leftStart = mainStart(left, vertical);
	const rightStart = mainStart(right, vertical);
	const leftEnd = leftStart + mainSize(left, vertical);
	const rightEnd = rightStart + mainSize(right, vertical);
	if (leftEnd <= rightStart) return false;
	if (rightEnd <= leftStart) return false;
	return true;
}

function forbiddenDisplacement(
	member: Readonly<MutableBounds>,
	group: Readonly<MutableBounds>,
	vertical: boolean,
): SeparationInterval | undefined {
	if (!overlapsMainAxes(member, group, vertical)) return undefined;
	const memberCrossStart = transverseStart(member, vertical);
	const memberCrossEnd = memberCrossStart + transverseSize(member, vertical);
	const groupCrossStart = transverseStart(group, vertical);
	const groupCrossEnd = groupCrossStart + transverseSize(group, vertical);
	return { start: groupCrossStart - memberCrossEnd, end: groupCrossEnd - memberCrossStart };
}

function intersectsZero(interval: SeparationInterval): boolean {
	if (interval.start >= 0) return false;
	return interval.end > 0;
}

function nearestBoundary(interval: SeparationInterval): number {
	const negativeDistance = -interval.start;
	if (negativeDistance <= interval.end) return interval.start;
	return interval.end;
}

function nearestAllowedDisplacement(intervals: SeparationInterval[]): number | undefined {
	intervals.sort((left, right) => left.start - right.start || left.end - right.end);
	let blocked: SeparationInterval | undefined;
	for (const interval of intervals) {
		if (blocked === undefined) {
			blocked = interval;
			continue;
		}
		if (interval.start > blocked.end) {
			if (intersectsZero(blocked)) return nearestBoundary(blocked);
			blocked = interval;
			continue;
		}
		blocked = { start: blocked.start, end: Math.max(blocked.end, interval.end) };
	}
	if (blocked !== undefined && intersectsZero(blocked)) return nearestBoundary(blocked);
	return undefined;
}

function displacementOutsideGroups(
	members: readonly Readonly<MutableBounds>[],
	groupIds: readonly string[],
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
): number | undefined {
	const intervals: SeparationInterval[] = [];
	for (const member of members) {
		for (const groupId of groupIds) {
			const group = bounds.get(groupId);
			if (group === undefined) continue;
			const interval = forbiddenDisplacement(member, group, vertical);
			if (interval !== undefined) intervals.push(interval);
		}
	}
	return nearestAllowedDisplacement(intervals);
}

function targetIsInsideGroup(
	groupIds: readonly string[],
	groupStart: number,
	groupEnd: number,
	hierarchy: GroupHierarchy,
): boolean {
	for (const groupId of groupIds) {
		const targetIndex = hierarchy.preorderIndexById.get(groupId);
		if (targetIndex === undefined) continue;
		if (targetIndex < groupStart) continue;
		if (targetIndex <= groupEnd) return true;
	}
	return false;
}

function groupSubtreeBounds(
	directGroupId: string,
	hierarchy: GroupHierarchy,
	bounds: ReadonlyMap<string, MutableBounds>,
): readonly MutableBounds[] {
	const pending = [directGroupId];
	const members: MutableBounds[] = [];
	while (pending.length > 0) {
		const groupId = defined(pending.pop());
		const groupBounds = bounds.get(groupId);
		if (groupBounds !== undefined) members.push(groupBounds);
		for (const memberId of hierarchy.membersById.get(groupId) ?? []) {
			const memberBounds = bounds.get(memberId);
			if (memberBounds !== undefined) members.push(memberBounds);
			if (hierarchy.byId.has(memberId)) pending.push(memberId);
		}
	}
	return members;
}

function movableBounds(
	nodeId: string,
	groupIds: readonly string[],
	context: SeparationContext,
): readonly MutableBounds[] {
	const { hierarchy, graph, bounds } = context;
	const node = bounds.get(nodeId);
	if (node === undefined) return [];
	const directGroupId = graph.endpointsById.get(nodeId)?.entity.groupId;
	if (directGroupId === undefined) return [node];
	const groupStart = hierarchy.preorderIndexById.get(directGroupId);
	const groupEnd = hierarchy.subtreeEndById.get(directGroupId);
	if (groupStart === undefined || groupEnd === undefined) return [node];
	if (targetIsInsideGroup(groupIds, groupStart, groupEnd, hierarchy)) return [node];
	return groupSubtreeBounds(directGroupId, hierarchy, bounds);
}

function overlappingTargetsByNode(
	candidates: readonly GroupSeparationCandidate[],
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
): Map<string, string[]> | undefined {
	let targetsByNode: Map<string, string[]> | undefined;
	for (const { groupId, nodeIds } of candidates) {
		const group = bounds.get(groupId);
		if (group === undefined) continue;
		for (const nodeId of nodeIds) {
			const node = bounds.get(nodeId);
			if (node === undefined) continue;
			if (!overlapsMainAxes(node, group, vertical)) continue;
			targetsByNode ??= new Map();
			const targets = targetsByNode.get(nodeId) ?? [];
			targets.push(groupId);
			targetsByNode.set(nodeId, targets);
		}
	}
	return targetsByNode;
}

interface SeparationExecution {
	readonly context: SeparationContext;
	readonly measurements: ReadonlyMap<string, GroupMeasurement>;
	readonly frame: LayoutFrame;
	readonly cursor: PackingCursor;
}

function moveNodeOutsideTargets(
	nodeId: string,
	targets: readonly string[],
	execution: SeparationExecution,
): void {
	const { context, measurements, frame, cursor } = execution;
	const members = movableBounds(nodeId, targets, context);
	const displacement = displacementOutsideGroups(members, targets, context.bounds, frame.vertical);
	if (displacement === undefined) return;
	for (const member of members) translateTransversely(member, displacement, frame.vertical);
	encloseGroups(
		{ hierarchy: context.hierarchy, measurements, bounds: context.bounds, frame },
		cursor,
	);
}

/** Move only actually interleaved non-members, using the nearest canonical transverse side. */
export function separateInterleavedGroupNodes(
	input: {
		readonly candidates: readonly GroupSeparationCandidate[];
		readonly hierarchy: GroupHierarchy;
		readonly graph: LogicGraph;
		readonly measurements: ReadonlyMap<string, GroupMeasurement>;
		readonly bounds: Map<string, MutableBounds>;
		readonly frame: LayoutFrame;
	},
	cursor: PackingCursor,
): void {
	const { candidates, hierarchy, graph, measurements, bounds, frame } = input;
	if (candidates.length === 0) return;
	const targetsByNode = overlappingTargetsByNode(candidates, bounds, frame.vertical);
	if (targetsByNode === undefined) return;
	const execution = { context: { hierarchy, graph, bounds }, measurements, frame, cursor };
	const nodeIds = [...targetsByNode.keys()].sort(compareCanonicalStrings);
	for (const nodeId of nodeIds) {
		const targets = defined(targetsByNode.get(nodeId));
		moveNodeOutsideTargets(nodeId, targets, execution);
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
