import { compareCanonicalStrings } from '../../canonical-string';
import { defined, EndpointKind, LayoutDirection } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	BASE_RANK_GAP,
	ITEM_GAP,
	OUTER_MARGIN,
	PORT_SPACING,
	RAIL_SPACING,
} from '../layout-settings';
import type {
	Bounds,
	LayoutElement,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
} from '../layout-types';
import type { ChannelRouting } from '../routing/channel-types';
import {
	channelFor,
	channelMaterializedRelations,
	compactCenters,
	indexById,
	legacyMaterializedRelations,
	orderedCenters,
	rails,
} from './independent-adjacent-channel-routing';
import { type AdjacentAxes, measuredAdjacentAxes } from './independent-adjacent-measurements';
import type { LayoutContractCandidate } from './layout-contract';
import type { CandidateFaceChoice } from './validate-candidate';

export enum AdjacentGeometryMode {
	Detour = 'detour',
	Bridge = 'bridge',
}

interface CanonicalBox {
	readonly u: number;
	readonly v: number;
	readonly crossSize: number;
	readonly flowSize: number;
}

interface CanonicalPoint {
	readonly u: number;
	readonly v: number;
}

interface CanonicalFrame {
	readonly vertical: boolean;
	readonly reversed: boolean;
	readonly crossExtent: number;
	readonly flowExtent: number;
}

function frame(
	direction: LayoutDirection,
	crossExtent: number,
	flowExtent: number,
): CanonicalFrame {
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const reversed =
		direction === LayoutDirection.BottomToTop || direction === LayoutDirection.RightToLeft;
	return { vertical, reversed, crossExtent, flowExtent };
}

function screenPoint(point: CanonicalPoint, frame: CanonicalFrame): Point {
	let flow = point.v;
	if (frame.reversed) flow = frame.flowExtent - flow;
	if (frame.vertical) return { x: point.u, y: flow };
	return { x: flow, y: point.u };
}

function screenBounds(box: CanonicalBox, frame: CanonicalFrame): Bounds {
	let flow = box.v;
	if (frame.reversed) flow = frame.flowExtent - box.v - box.flowSize;
	if (frame.vertical) return { x: box.u, y: flow, width: box.crossSize, height: box.flowSize };
	return { x: flow, y: box.u, width: box.flowSize, height: box.crossSize };
}

function relationPortOffsets(ids: readonly string[]): ReadonlyMap<string, number> {
	const middle = (ids.length - 1) / 2;
	return new Map(ids.map((id, index) => [id, (index - middle) * PORT_SPACING]));
}

function sourcePorts(
	graph: LogicGraph,
	candidate: LayoutContractCandidate,
	centers: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const targetIndex = indexById(candidate.targetOrder);
	const result = new Map<string, number>();
	for (const sourceId of candidate.sourceOrder) {
		const outgoing = graph.relations
			.filter(({ relation }) => relation.from === sourceId)
			.map(({ relation }) => relation)
			.sort(
				(a, b) =>
					defined(targetIndex.get(a.to)) - defined(targetIndex.get(b.to)) ||
					compareCanonicalStrings(a.id, b.id),
			);
		const offsets = relationPortOffsets(outgoing.map(({ id }) => id));
		for (const relation of outgoing)
			result.set(relation.id, defined(centers.get(sourceId)) + defined(offsets.get(relation.id)));
	}
	return result;
}

function targetPorts(
	graph: LogicGraph,
	choices: readonly CandidateFaceChoice[],
	centers: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> | undefined {
	const result = new Map<string, number>();
	for (const choice of choices) {
		const center = centers.get(choice.endpointId);
		if (center === undefined) return undefined;
		const offsets = relationPortOffsets(choice.physicalPortGroups.map((_, index) => String(index)));
		for (const [index, group] of choice.physicalPortGroups.entries()) {
			const offset = defined(offsets.get(String(index)));
			if (!recordTargetPortGroup(result, group, center + offset)) return undefined;
		}
	}
	if (result.size !== graph.relations.length) return undefined;
	if (graph.relations.some(({ relation }) => !result.has(relation.id))) return undefined;
	return result;
}

function recordTargetPortGroup(
	result: Map<string, number>,
	group: readonly string[],
	position: number,
): boolean {
	for (const relationId of group) {
		if (result.has(relationId)) return false;
		result.set(relationId, position);
	}
	return true;
}

function canonicalBoxes(input: {
	readonly candidate: LayoutContractCandidate;
	readonly axes: ReadonlyMap<string, AdjacentAxes>;
	readonly centers: ReadonlyMap<string, number>;
	readonly targetBottom: number;
	readonly sourceTop: number;
}): ReadonlyMap<string, CanonicalBox> {
	const { candidate, axes, centers, targetBottom, sourceTop } = input;
	const boxes = new Map<string, CanonicalBox>();
	for (const id of candidate.targetOrder) {
		const { crossSize, flowSize } = defined(axes.get(id));
		boxes.set(id, {
			u: defined(centers.get(id)) - crossSize / 2,
			v: targetBottom - flowSize,
			crossSize,
			flowSize,
		});
	}
	for (const id of candidate.sourceOrder) {
		const { crossSize, flowSize } = defined(axes.get(id));
		boxes.set(id, {
			u: defined(centers.get(id)) - crossSize / 2,
			v: sourceTop,
			crossSize,
			flowSize,
		});
	}
	return boxes;
}

function rankExtents(input: {
	readonly candidate: LayoutContractCandidate;
	readonly axes: ReadonlyMap<string, AdjacentAxes>;
	readonly gap: number;
}): { targetBottom: number; sourceTop: number; flowExtent: number } {
	const { candidate, axes, gap } = input;
	const maximumTargetFlow = Math.max(
		...candidate.targetOrder.map((id) => defined(axes.get(id)).flowSize),
	);
	const maximumSourceFlow = Math.max(
		...candidate.sourceOrder.map((id) => defined(axes.get(id)).flowSize),
	);
	const targetBottom = OUTER_MARGIN + maximumTargetFlow;
	const sourceTop = targetBottom + BASE_RANK_GAP + gap;
	const flowExtent = sourceTop + maximumSourceFlow + OUTER_MARGIN;
	return { targetBottom, sourceTop, flowExtent };
}

function layoutDimensions(input: {
	readonly vertical: boolean;
	readonly crossExtent: number;
	readonly flowExtent: number;
}): { width: number; height: number } {
	const { vertical, crossExtent, flowExtent } = input;
	if (vertical) return { width: crossExtent, height: flowExtent };
	return { width: flowExtent, height: crossExtent };
}

interface AdjacentGeometryInput {
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly candidate: LayoutContractCandidate;
	readonly choices: readonly CandidateFaceChoice[];
	readonly geometry: AdjacentGeometryMode;
}

/** A deliberately bounded, independent materializer for adjacent 3+1 and 2+2 contracts. */
function materializeAdjacentGeometry(input: AdjacentGeometryInput): LayoutResult | undefined {
	const { graph, measurements, candidate, choices, geometry } = input;
	if (candidate.sourceOrder.length !== 3 || candidate.targetOrder.length !== 2) return undefined;
	const direction = graph.document.layout.direction;
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const chosen = new Map(choices.map((choice) => [choice.endpointId, choice]));
	if (chosen.size !== 2 || candidate.targetOrder.some((id) => !chosen.has(id))) return undefined;
	const axes = measuredAdjacentAxes({ graph, measurements, candidate, chosen, vertical });
	if (axes === undefined) return undefined;
	const maximumCrossSize = Math.max(...[...axes.values()].map(({ crossSize }) => crossSize));
	let centers: ReadonlyMap<string, number>;
	let crossExtent: number;
	if (geometry === AdjacentGeometryMode.Bridge) {
		({ centers, crossExtent } = compactCenters(candidate, axes));
	} else {
		const step = maximumCrossSize + ITEM_GAP + RAIL_SPACING;
		const firstCenter = OUTER_MARGIN + maximumCrossSize / 2;
		centers = orderedCenters(candidate, firstCenter, step);
		const lastCenter = firstCenter + 2 * step;
		const lastExtent = lastCenter + maximumCrossSize / 2;
		crossExtent = lastExtent + OUTER_MARGIN;
	}
	const sourceByRelation = sourcePorts(graph, candidate, centers);
	const targetByRelation = targetPorts(graph, choices, centers);
	if (targetByRelation === undefined) return undefined;
	let channel: ChannelRouting | undefined;
	let orderedRails: readonly string[] = [];
	if (geometry === AdjacentGeometryMode.Bridge)
		channel = channelFor({ graph, sourceByRelation, targetByRelation });
	else orderedRails = rails(graph, candidate, centers);
	let gap = (orderedRails.length + 1) * RAIL_SPACING;
	if (channel !== undefined) gap = Math.max(0, channel.railCount - 1) * RAIL_SPACING;
	const { targetBottom, sourceTop, flowExtent } = rankExtents({ candidate, axes, gap });
	const boxes = canonicalBoxes({ candidate, axes, centers, targetBottom, sourceTop });
	const outputFrame = frame(direction, crossExtent, flowExtent);
	const elements: LayoutElement[] = [...boxes]
		.sort(([a], [b]) => compareCanonicalStrings(a, b))
		.map(([id, box]) => ({ id, kind: EndpointKind.Node, bounds: screenBounds(box, outputFrame) }));
	let relations: readonly LayoutRelation[];
	if (channel !== undefined)
		relations = channelMaterializedRelations({
			graph,
			channel,
			sourceTop,
			targetBottom,
			projectPoint: (point) => screenPoint({ u: point.x, v: point.y }, outputFrame),
		});
	else {
		const railByRelation = new Map(
			orderedRails.map((id, index) => [id, targetBottom + (index + 1) * RAIL_SPACING]),
		);
		relations = legacyMaterializedRelations({
			graph,
			projectPoint: (point) => screenPoint(point, outputFrame),
			sourceByRelation,
			targetByRelation,
			railByRelation,
			sourceTop,
			targetBottom,
		});
	}
	const { width, height } = layoutDimensions({ vertical, crossExtent, flowExtent });
	return {
		width,
		height,
		elements,
		relations,
	};
}

export function materializeIndependentAdjacentGeometry(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	candidate: LayoutContractCandidate,
	choices: readonly CandidateFaceChoice[],
): LayoutResult | undefined {
	return materializeAdjacentGeometry({
		graph,
		measurements,
		candidate,
		choices,
		geometry: AdjacentGeometryMode.Detour,
	});
}

export function materializeIndependentAdjacentBridgeGeometry(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	candidate: LayoutContractCandidate,
	choices: readonly CandidateFaceChoice[],
): LayoutResult | undefined {
	return materializeAdjacentGeometry({
		graph,
		measurements,
		candidate,
		choices,
		geometry: AdjacentGeometryMode.Bridge,
	});
}
