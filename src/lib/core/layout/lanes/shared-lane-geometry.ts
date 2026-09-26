import { compareCanonicalStrings } from '../../canonical-string';
import { defined, LaneOrientation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	crossEnd,
	crossStart,
	finiteBounds,
	inside,
	longEnd,
	longStart,
	overlapping,
} from '../geometry/shared-lane-geometry-primitives';
import type { Bounds, LayoutElement } from '../layout-types';
import { SHARED_LANE_CLEARANCE } from './shared-lane-frame';
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

interface IndexedElement {
	readonly element: LayoutElement;
	readonly index: number;
}

interface SpatialBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

enum BoxIndexNodeKind {
	Leaf = 'leaf',
	Branch = 'branch',
}

type BoxIndexNode =
	| (SpatialBounds & {
			readonly kind: BoxIndexNodeKind.Leaf;
			readonly minimumIndex: number;
			readonly maximumIndex: number;
			readonly elements: readonly IndexedElement[];
	  })
	| (SpatialBounds & {
			readonly kind: BoxIndexNodeKind.Branch;
			readonly minimumIndex: number;
			readonly maximumIndex: number;
			readonly left: BoxIndexNode;
			readonly right: BoxIndexNode;
	  });

const BOX_INDEX_LEAF_SIZE = 8;

function elementBounds(elements: readonly IndexedElement[]): SpatialBounds {
	const first = defined(elements[0]).element.bounds;
	let minX = first.x;
	let minY = first.y;
	let maxX = first.x + first.width;
	let maxY = first.y + first.height;
	for (let index = 1; index < elements.length; index += 1) {
		const bounds = defined(elements[index]).element.bounds;
		minX = Math.min(minX, bounds.x);
		minY = Math.min(minY, bounds.y);
		maxX = Math.max(maxX, bounds.x + bounds.width);
		maxY = Math.max(maxY, bounds.y + bounds.height);
	}
	return { minX, minY, maxX, maxY };
}

function buildBoxIndex(elements: readonly IndexedElement[]): BoxIndexNode {
	const bounds = elementBounds(elements);
	let minimumIndex = Number.MAX_SAFE_INTEGER;
	let maximumIndex = -1;
	for (const { index } of elements) {
		minimumIndex = Math.min(minimumIndex, index);
		maximumIndex = Math.max(maximumIndex, index);
	}
	if (elements.length <= BOX_INDEX_LEAF_SIZE)
		return {
			...bounds,
			kind: BoxIndexNodeKind.Leaf,
			minimumIndex,
			maximumIndex,
			elements,
		};

	const splitX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
	const ordered = [...elements].sort((left, right) => {
		const leftBounds = left.element.bounds;
		const rightBounds = right.element.bounds;
		let leftCenter = leftBounds.x + leftBounds.width / 2;
		let rightCenter = rightBounds.x + rightBounds.width / 2;
		if (!splitX) {
			leftCenter = leftBounds.y + leftBounds.height / 2;
			rightCenter = rightBounds.y + rightBounds.height / 2;
		}
		return leftCenter - rightCenter || left.index - right.index;
	});
	const middle = Math.floor(ordered.length / 2);
	const left = buildBoxIndex(ordered.slice(0, middle));
	const right = buildBoxIndex(ordered.slice(middle));
	const leftMinimumIndex = left.minimumIndex;
	const rightMinimumIndex = right.minimumIndex;
	const leftMaximumIndex = left.maximumIndex;
	const rightMaximumIndex = right.maximumIndex;
	return {
		...bounds,
		kind: BoxIndexNodeKind.Branch,
		minimumIndex: Math.min(leftMinimumIndex, rightMinimumIndex),
		maximumIndex: Math.max(leftMaximumIndex, rightMaximumIndex),
		left,
		right,
	};
}

function intersects(bounds: Bounds, index: SpatialBounds): boolean {
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	const overlapsX = bounds.x < index.maxX && right > index.minX;
	const overlapsY = bounds.y < index.maxY && bottom > index.minY;
	return overlapsX && overlapsY;
}

function firstOverlapAfter(
	query: IndexedElement,
	node: BoxIndexNode,
	maximumCandidateIndex: number,
): number | undefined {
	const isBeforeQuery = node.maximumIndex <= query.index;
	const isAfterCandidates = node.minimumIndex >= maximumCandidateIndex;
	if (isBeforeQuery || isAfterCandidates) return undefined;
	if (!intersects(query.element.bounds, node)) return undefined;
	if (node.kind === BoxIndexNodeKind.Leaf) {
		let first: number | undefined;
		for (const candidate of node.elements) {
			const firstIndex = first ?? maximumCandidateIndex;
			if (candidate.index <= query.index || candidate.index >= firstIndex) continue;
			if (overlapping(query.element.bounds, candidate.element.bounds)) first = candidate.index;
		}
		return first;
	}
	const left = firstOverlapAfter(query, node.left, maximumCandidateIndex);
	const right = firstOverlapAfter(query, node.right, left ?? maximumCandidateIndex);
	if (left === undefined) return right;
	if (right === undefined) return left;
	return Math.min(left, right);
}

function validateBoxSeparation(geometry: SharedLaneGeometry): string | undefined {
	const sorted = [...geometry.elements].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const elements = sorted.map((element, index) => ({ element, index }));
	if (elements.length < 2) return undefined;
	const index = buildBoxIndex(elements);
	for (const current of elements) {
		const overlap = firstOverlapAfter(current, index, Number.MAX_SAFE_INTEGER);
		if (overlap !== undefined)
			return `Elements ${current.element.id} and ${defined(sorted[overlap]).id} overlap.`;
	}
	return undefined;
}

export interface SharedLaneGeometryCertificate {
	readonly graph: LogicGraph;
	readonly lanes: SharedLaneGeometry['lanes'];
	readonly elements: SharedLaneGeometry['elements'];
	readonly width: number;
	readonly height: number;
	readonly issue: string | undefined;
}

function validateStaticGeometry(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
): string | undefined {
	if (graph.document.presentation === undefined) return 'Explicit lanes are required.';
	if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height))
		return 'The geometry extent is non-finite.';
	if (geometry.width <= 0 || geometry.height <= 0) return 'The geometry extent is non-positive.';
	const laneIssue = validateLanes(graph, geometry);
	if (laneIssue !== undefined) return laneIssue;
	const boxIssue = validateBoxes(graph, geometry);
	if (boxIssue !== undefined) return boxIssue;
	return validateBoxSeparation(geometry);
}

export function certifySharedLaneGeometry(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
): SharedLaneGeometryCertificate {
	return {
		graph,
		lanes: geometry.lanes,
		elements: geometry.elements,
		width: geometry.width,
		height: geometry.height,
		issue: validateStaticGeometry(graph, geometry),
	};
}

function certificateMatches(
	certificate: SharedLaneGeometryCertificate,
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
): boolean {
	const sameGraph = certificate.graph === graph;
	const sameLanes = certificate.lanes === geometry.lanes;
	const sameElements = certificate.elements === geometry.elements;
	const sameWidth = certificate.width === geometry.width;
	const sameHeight = certificate.height === geometry.height;
	const sameStaticGeometry = sameGraph && sameLanes && sameElements;
	const sameDimensions = sameWidth && sameHeight;
	return sameStaticGeometry && sameDimensions;
}

/** A candidate is checked against the source graph, not against the solver's plans. */
export function validateSharedLaneGeometry(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	clearance = SHARED_LANE_CLEARANCE,
	acceptBridges = false,
): string | undefined {
	const validation = validateStaticGeometry(graph, geometry);
	if (validation !== undefined) return validation;
	return validateSharedLaneRoutes(graph, geometry, clearance, acceptBridges);
}

export function validateSharedLaneGeometryWithCertificate(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	certificate: SharedLaneGeometryCertificate,
	acceptBridges: boolean,
): string | undefined {
	const validation = validateSharedLaneStaticGeometryWithCertificate(graph, geometry, certificate);
	if (validation !== undefined) return validation;
	return validateSharedLaneRoutes(graph, geometry, SHARED_LANE_CLEARANCE, acceptBridges);
}

export function validateSharedLaneStaticGeometryWithCertificate(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	certificate: SharedLaneGeometryCertificate,
): string | undefined {
	if (certificateMatches(certificate, graph, geometry)) return certificate.issue;
	return validateStaticGeometry(graph, geometry);
}
