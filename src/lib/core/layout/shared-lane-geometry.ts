import { compareCanonicalStrings } from '../canonical-string';
import { defined, LaneOrientation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { Bounds } from './layout-types';
import {
	crossEnd,
	crossStart,
	finiteBounds,
	inside,
	longEnd,
	longStart,
	overlapping,
} from './shared-lane-geometry-primitives';
import { orderedLaneIds, reverseDirection, verticalDirection } from './shared-lane-model';
import { validateSharedLaneRoutes } from './shared-lane-route-validation';
import type { SharedLaneGeometry } from './shared-lane-types';

export type { SharedLaneGeometry } from './shared-lane-types';

interface LaneAxis {
	readonly orientation: LaneOrientation;
	readonly vertical: boolean;
	readonly reverse: boolean;
}

function lanesOutOfOrder(previous: Bounds, current: Bounds, axis: LaneAxis): boolean {
	if (axis.orientation === LaneOrientation.Parallel)
		return crossEnd(previous, axis.vertical) >= crossStart(current, axis.vertical);
	if (axis.reverse) return longStart(previous, axis.vertical) <= longEnd(current, axis.vertical);
	return longEnd(previous, axis.vertical) >= longStart(current, axis.vertical);
}

function validateLanes(graph: LogicGraph, geometry: SharedLaneGeometry): string | undefined {
	const ids = orderedLaneIds(graph.document);
	if (ids.length !== geometry.lanes.length) return 'The lane set is incomplete.';
	const axis: LaneAxis = {
		vertical: verticalDirection(graph.document.layout.direction),
		reverse: reverseDirection(graph.document.layout.direction),
		orientation: defined(graph.document.presentation).laneOrientation,
	};
	const canvas = { x: 0, y: 0, width: geometry.width, height: geometry.height };
	for (const [index, id] of ids.entries()) {
		const placed = geometry.lanes[index];
		if (placed?.id !== id) return `Lane order or identity differs at ${id}.`;
		if (!finiteBounds(placed.bounds)) return `Lane ${id} has invalid bounds.`;
		if (!inside(placed.bounds, canvas)) return `Lane ${id} escapes the canvas.`;
		const previous = geometry.lanes[index - 1];
		if (previous === undefined) continue;
		if (lanesOutOfOrder(previous.bounds, placed.bounds, axis))
			return `Lane ${id} overlaps its predecessor.`;
	}
	return undefined;
}

function validateBoxes(graph: LogicGraph, geometry: SharedLaneGeometry): string | undefined {
	const expected = [...graph.document.nodes, ...graph.document.groups];
	if (expected.length !== geometry.elements.length) return 'The element set is incomplete.';
	const boxById = new Map(geometry.elements.map((element) => [element.id, element]));
	if (boxById.size !== expected.length) return 'The element set contains duplicates.';
	for (const item of expected) {
		const box = boxById.get(item.id);
		if (box?.kind !== item.kind) return `Element identity or kind differs at ${item.id}.`;
		if (!finiteBounds(box.bounds)) return `Element ${item.id} has invalid bounds.`;
		const lane = geometry.lanes.find(({ id }) => id === item.laneId);
		if (lane === undefined || !inside(box.bounds, lane.bounds))
			return `Element ${item.id} escapes its lane.`;
	}
	return undefined;
}

function validateBoxSeparation(geometry: SharedLaneGeometry): string | undefined {
	const boxes = [...geometry.elements].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	for (let first = 0; first < boxes.length; first += 1) {
		const a = defined(boxes[first]);
		for (let second = first + 1; second < boxes.length; second += 1) {
			const b = defined(boxes[second]);
			if (overlapping(a.bounds, b.bounds)) return `Elements ${a.id} and ${b.id} overlap.`;
		}
	}
	return undefined;
}

/** A candidate is checked against the source graph, not against the solver's plans. */
export function validateSharedLaneGeometry(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	clearance = 12,
	acceptBridges = false,
): string | undefined {
	if (graph.document.presentation === undefined) return 'Explicit lanes are required.';
	if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height))
		return 'The geometry extent is non-finite.';
	if (geometry.width <= 0 || geometry.height <= 0) return 'The geometry extent is non-positive.';
	const laneIssue = validateLanes(graph, geometry);
	if (laneIssue !== undefined) return laneIssue;
	const boxIssue = validateBoxes(graph, geometry);
	if (boxIssue !== undefined) return boxIssue;
	const overlapIssue = validateBoxSeparation(geometry);
	if (overlapIssue !== undefined) return overlapIssue;
	return validateSharedLaneRoutes(graph, geometry, clearance, acceptBridges);
}
