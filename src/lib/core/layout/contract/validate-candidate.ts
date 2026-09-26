import { compareCanonicalStrings } from '../../canonical-string';
import { defined, LayoutDirection } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	boundsOverlap,
	finitePositiveBounds,
	onPrincipalFace,
	segmentEntersInterior,
} from '../geometry/box-geometry';
import type {
	Bounds,
	LayoutMeasurements,
	LayoutRelation,
	LayoutResult,
	Point,
} from '../layout-types';
import type { LayoutContractCandidate } from './layout-contract';
import type { FaceCapacityMetricDemand } from './metric-demand';
import { SourceFaceDemandFailure, validateSourceFaceDemands } from './validate-source-face-demand';

export enum CandidateGeometryReason {
	Elements = 'elements',
	Bounds = 'bounds',
	Order = 'order',
	Relations = 'relations',
	Attachment = 'attachment',
	Route = 'route',
	Obstacle = 'obstacle',
	Ports = 'ports',
	MetricDemand = 'metric-demand',
}

export interface CandidateFaceChoice {
	readonly endpointId: string;
	readonly physicalPortGroups: readonly (readonly string[])[];
	readonly metricDemand: FaceCapacityMetricDemand;
}

interface ValidCandidateGeometry {
	readonly valid: true;
}

interface InvalidCandidateGeometry {
	readonly valid: false;
	readonly reason: CandidateGeometryReason;
}

export type CandidateGeometryValidation = ValidCandidateGeometry | InvalidCandidateGeometry;

export interface ContractCandidateValidationInput {
	readonly graph: LogicGraph;
	readonly candidate: LayoutContractCandidate;
	readonly measurements: LayoutMeasurements;
	readonly layout: LayoutResult;
	readonly choices: readonly CandidateFaceChoice[];
}

function invalid(reason: CandidateGeometryReason): InvalidCandidateGeometry {
	return { valid: false, reason };
}

function actualOrder(
	ids: readonly string[],
	boxes: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): readonly string[] | undefined {
	const located = ids.map((id) => {
		const box = defined(boxes.get(id));
		let cross = box.y + box.height / 2;
		if (vertical) cross = box.x + box.width / 2;
		return { id, cross };
	});
	located.sort((a, b) => a.cross - b.cross);
	for (let index = 1; index < located.length; index += 1) {
		if (located[index]?.cross === located[index - 1]?.cross) return undefined;
	}
	return located.map(({ id }) => id);
}

function validateRoute(
	relation: LayoutRelation,
	boxes: ReadonlyMap<string, Bounds>,
	direction: LayoutDirection,
): CandidateGeometryValidation {
	const source = defined(boxes.get(relation.from));
	const target = defined(boxes.get(relation.to));
	const first = relation.points[0];
	const last = relation.points.at(-1);
	if (first === undefined || last === undefined) return invalid(CandidateGeometryReason.Route);
	if (first.x === last.x && first.y === last.y) return invalid(CandidateGeometryReason.Route);
	if (!onPrincipalFace(first, source, direction, true))
		return invalid(CandidateGeometryReason.Attachment);
	if (!onPrincipalFace(last, target, direction, false))
		return invalid(CandidateGeometryReason.Attachment);
	return validateRouteSegments(relation.points, boxes);
}

function validateRouteSegments(
	points: readonly Point[],
	boxes: ReadonlyMap<string, Bounds>,
): CandidateGeometryValidation {
	for (const [index, point] of points.entries()) {
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
			return invalid(CandidateGeometryReason.Route);
		if (index === 0) continue;
		const previous = defined(points[index - 1]);
		if (point.x !== previous.x && point.y !== previous.y)
			return invalid(CandidateGeometryReason.Route);
		for (const box of boxes.values()) {
			if (segmentEntersInterior(previous, point, box))
				return invalid(CandidateGeometryReason.Obstacle);
		}
	}
	return { valid: true };
}

function physicalPortGroups(
	relations: readonly LayoutRelation[],
	targetId: string,
	vertical: boolean,
): readonly (readonly string[])[] {
	const byCross = new Map<number, string[]>();
	for (const relation of relations) {
		if (relation.to !== targetId) continue;
		const last = defined(relation.points.at(-1));
		let cross = last.y;
		if (vertical) cross = last.x;
		const family = byCross.get(cross) ?? [];
		family.push(relation.id);
		byCross.set(cross, family);
	}
	return [...byCross].sort(([a], [b]) => a - b).map(([, ids]) => ids.sort(compareCanonicalStrings));
}

function hasOverlappingBoxes(elements: LayoutResult['elements']): boolean {
	for (const [index, first] of elements.entries()) {
		for (const second of elements.slice(index + 1)) {
			if (boundsOverlap(first.bounds, second.bounds)) return true;
		}
	}
	return false;
}

function validateBoxes(
	graph: LogicGraph,
	measurements: LayoutMeasurements,
	layout: LayoutResult,
	boxes: ReadonlyMap<string, Bounds>,
): CandidateGeometryValidation {
	const expectedIds = [...graph.endpointsById.keys()].sort(compareCanonicalStrings);
	const actualIds = layout.elements.map(({ id }) => id).sort(compareCanonicalStrings);
	if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
		return invalid(CandidateGeometryReason.Elements);
	if (!Number.isFinite(layout.width) || !Number.isFinite(layout.height))
		return invalid(CandidateGeometryReason.Bounds);
	for (const id of expectedIds) {
		const box = defined(boxes.get(id));
		const measured = measurements.nodes.get(id);
		if (measured === undefined) return invalid(CandidateGeometryReason.Bounds);
		if (!finitePositiveBounds(box)) return invalid(CandidateGeometryReason.Bounds);
		if (box.width < measured.width || box.height < measured.height)
			return invalid(CandidateGeometryReason.Bounds);
		if (box.x < 0 || box.y < 0) return invalid(CandidateGeometryReason.Bounds);
		const right = box.x + box.width;
		const bottom = box.y + box.height;
		if (right > layout.width || bottom > layout.height)
			return invalid(CandidateGeometryReason.Bounds);
	}
	if (hasOverlappingBoxes(layout.elements)) return invalid(CandidateGeometryReason.Bounds);
	return { valid: true };
}

function validateOrders(
	candidate: LayoutContractCandidate,
	boxes: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): CandidateGeometryValidation {
	if (
		JSON.stringify(actualOrder(candidate.sourceOrder, boxes, vertical)) !==
		JSON.stringify(candidate.sourceOrder)
	)
		return invalid(CandidateGeometryReason.Order);
	if (
		JSON.stringify(actualOrder(candidate.targetOrder, boxes, vertical)) !==
		JSON.stringify(candidate.targetOrder)
	)
		return invalid(CandidateGeometryReason.Order);
	return { valid: true };
}

function validateRelations(
	graph: LogicGraph,
	layout: LayoutResult,
	boxes: ReadonlyMap<string, Bounds>,
): CandidateGeometryValidation {
	const expectedIds = graph.relations
		.map(({ relation }) => relation.id)
		.sort(compareCanonicalStrings);
	const actualIds = layout.relations.map(({ id }) => id).sort(compareCanonicalStrings);
	if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds))
		return invalid(CandidateGeometryReason.Relations);
	for (const route of layout.relations) {
		const source = defined(
			graph.relations.find(({ relation }) => relation.id === route.id),
		).relation;
		if (source.from !== route.from || source.to !== route.to)
			return invalid(CandidateGeometryReason.Relations);
		const checked = validateRoute(route, boxes, graph.document.layout.direction);
		if (!checked.valid) return checked;
	}
	return { valid: true };
}

function validateChoices(
	choices: readonly CandidateFaceChoice[],
	layout: LayoutResult,
	boxes: ReadonlyMap<string, Bounds>,
	vertical: boolean,
): CandidateGeometryValidation {
	for (const choice of choices) {
		const box = boxes.get(choice.endpointId);
		if (box === undefined) return invalid(CandidateGeometryReason.Elements);
		let crossSize = box.height;
		if (vertical) crossSize = box.width;
		if (crossSize < choice.metricDemand.minimumCrossSize)
			return invalid(CandidateGeometryReason.MetricDemand);
		const actual = physicalPortGroups(layout.relations, choice.endpointId, vertical);
		if (JSON.stringify(actual) !== JSON.stringify(choice.physicalPortGroups))
			return invalid(CandidateGeometryReason.Ports);
	}
	return { valid: true };
}

/** Independent candidate check: boxes, principal attachments, orthogonal routes, obstacles and ports. */
export function validateContractCandidate(
	input: ContractCandidateValidationInput,
): CandidateGeometryValidation {
	const { graph, candidate, measurements, layout, choices } = input;
	const boxes = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	const boxResult = validateBoxes(graph, measurements, layout, boxes);
	if (!boxResult.valid) return boxResult;
	const direction = graph.document.layout.direction;
	const vertical =
		direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
	const orderResult = validateOrders(candidate, boxes, vertical);
	if (!orderResult.valid) return orderResult;
	const routeResult = validateRelations(graph, layout, boxes);
	if (!routeResult.valid) return routeResult;
	const sourceFailure = validateSourceFaceDemands({ graph, candidate, layout, boxes, vertical });
	if (sourceFailure === SourceFaceDemandFailure.MetricDemand)
		return invalid(CandidateGeometryReason.MetricDemand);
	if (sourceFailure === SourceFaceDemandFailure.Ports)
		return invalid(CandidateGeometryReason.Ports);
	return validateChoices(choices, layout, boxes, vertical);
}
