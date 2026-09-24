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
import { type AdjacentAxes, measuredAdjacentAxes } from './independent-adjacent-measurements';
import type { LayoutContractCandidate } from './layout-contract';
import type { CandidateFaceChoice } from './validate-candidate';

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

function indexById(ids: readonly string[]): ReadonlyMap<string, number> {
	return new Map(ids.map((id, index) => [id, index]));
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

function rails(
	graph: LogicGraph,
	candidate: LayoutContractCandidate,
	centers: ReadonlyMap<string, number>,
): readonly string[] {
	const sourceIndex = indexById(candidate.sourceOrder);
	const targetIndex = indexById(candidate.targetOrder);
	const incidences = new Map(candidate.targetOrder.map((id) => [id, 0]));
	for (const { relation } of graph.relations)
		incidences.set(relation.to, defined(incidences.get(relation.to)) + 1);
	const firstSource = defined(candidate.sourceOrder[0]);
	const lastSource = defined(candidate.sourceOrder.at(-1));
	const midpoint = (defined(centers.get(firstSource)) + defined(centers.get(lastSource))) / 2;
	return graph.relations
		.map(({ relation }) => relation)
		.sort((a, b) => {
			const degree = defined(incidences.get(a.to)) - defined(incidences.get(b.to));
			if (degree !== 0) return degree;
			const target = defined(centers.get(a.to));
			let sourceOrder = defined(sourceIndex.get(a.from)) - defined(sourceIndex.get(b.from));
			if (target < midpoint) sourceOrder = -sourceOrder;
			if (sourceOrder !== 0) return sourceOrder;
			return (
				defined(targetIndex.get(a.to)) - defined(targetIndex.get(b.to)) ||
				compareCanonicalStrings(a.id, b.id)
			);
		})
		.map(({ id }) => id);
}

function orderedCenters(
	candidate: LayoutContractCandidate,
	firstCenter: number,
	step: number,
): ReadonlyMap<string, number> {
	const centers = new Map<string, number>();
	for (const [index, id] of candidate.sourceOrder.entries())
		centers.set(id, firstCenter + index * step);
	for (const [index, id] of candidate.targetOrder.entries())
		centers.set(id, firstCenter + index * step * 2);
	return centers;
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

function materializedRelations(input: {
	readonly graph: LogicGraph;
	readonly outputFrame: CanonicalFrame;
	readonly sourceByRelation: ReadonlyMap<string, number>;
	readonly targetByRelation: ReadonlyMap<string, number>;
	readonly railByRelation: ReadonlyMap<string, number>;
	readonly sourceTop: number;
	readonly targetBottom: number;
}): readonly LayoutRelation[] {
	const {
		graph,
		outputFrame,
		sourceByRelation,
		targetByRelation,
		railByRelation,
		sourceTop,
		targetBottom,
	} = input;
	return graph.relations.map(({ relation }) => {
		const sourceU = defined(sourceByRelation.get(relation.id));
		const targetU = defined(targetByRelation.get(relation.id));
		const rail = defined(railByRelation.get(relation.id));
		const points: CanonicalPoint[] = [
			{ u: sourceU, v: sourceTop },
			{ u: sourceU, v: rail },
			{ u: targetU, v: rail },
			{ u: targetU, v: targetBottom },
		];
		return { ...relation, points: points.map((point) => screenPoint(point, outputFrame)) };
	});
}

/** A deliberately bounded, independent materializer for adjacent 3+1 and 2+2 contracts. */
export function materializeIndependentAdjacentGeometry(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	candidate: LayoutContractCandidate,
	choices: readonly CandidateFaceChoice[],
): LayoutResult | undefined {
	if (candidate.sourceOrder.length !== 3 || candidate.targetOrder.length !== 2) return undefined;
	const direction = graph.document.layout.direction;
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const chosen = new Map(choices.map((choice) => [choice.endpointId, choice]));
	if (chosen.size !== 2 || candidate.targetOrder.some((id) => !chosen.has(id))) return undefined;
	const axes = measuredAdjacentAxes({ graph, measurements, candidate, chosen, vertical });
	if (axes === undefined) return undefined;
	const maximumCrossSize = Math.max(...[...axes.values()].map(({ crossSize }) => crossSize));
	const step = maximumCrossSize + ITEM_GAP + RAIL_SPACING;
	const firstCenter = OUTER_MARGIN + maximumCrossSize / 2;
	const centers = orderedCenters(candidate, firstCenter, step);
	const maxTargetFlow = Math.max(
		...candidate.targetOrder.map((id) => defined(axes.get(id)).flowSize),
	);
	const maxSourceFlow = Math.max(
		...candidate.sourceOrder.map((id) => defined(axes.get(id)).flowSize),
	);
	const targetBottom = OUTER_MARGIN + maxTargetFlow;
	const orderedRails = rails(graph, candidate, centers);
	const railHeight = (orderedRails.length + 1) * RAIL_SPACING;
	const sourceTop = targetBottom + BASE_RANK_GAP + railHeight;
	const boxes = canonicalBoxes({ candidate, axes, centers, targetBottom, sourceTop });
	const lastCenter = firstCenter + 2 * step;
	const crossExtent = lastCenter + maximumCrossSize / 2 + OUTER_MARGIN;
	const flowExtent = sourceTop + maxSourceFlow + OUTER_MARGIN;
	const outputFrame = frame(direction, crossExtent, flowExtent);
	const sourceByRelation = sourcePorts(graph, candidate, centers);
	const targetByRelation = targetPorts(graph, choices, centers);
	if (targetByRelation === undefined) return undefined;
	const railByRelation = new Map(
		orderedRails.map((id, index) => [id, targetBottom + (index + 1) * RAIL_SPACING]),
	);
	const elements: LayoutElement[] = [...boxes]
		.sort(([a], [b]) => compareCanonicalStrings(a, b))
		.map(([id, box]) => ({ id, kind: EndpointKind.Node, bounds: screenBounds(box, outputFrame) }));
	const relations = materializedRelations({
		graph,
		outputFrame,
		sourceByRelation,
		targetByRelation,
		railByRelation,
		sourceTop,
		targetBottom,
	});
	let width = crossExtent;
	let height = flowExtent;
	if (!vertical) {
		width = flowExtent;
		height = crossExtent;
	}
	return {
		width,
		height,
		elements,
		relations,
	};
}
