import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds, LayoutResult, Point } from '../layout-types';
import type { LayoutContractCandidate } from './layout-contract';

export enum SourceFaceDemandFailure {
	MetricDemand = 'metric-demand',
	Ports = 'ports',
}

interface SourceFaceDemandInput {
	readonly graph: LogicGraph;
	readonly candidate: LayoutContractCandidate;
	readonly layout: LayoutResult;
	readonly boxes: ReadonlyMap<string, Bounds>;
	readonly vertical: boolean;
}

function crossCoordinate(point: Point, vertical: boolean): number {
	if (vertical) return point.x;
	return point.y;
}

function crossExtent(box: Bounds, vertical: boolean): { start: number; size: number } {
	if (vertical) return { start: box.x, size: box.width };
	return { start: box.y, size: box.height };
}

function outgoingCoordinates(input: {
	readonly layout: LayoutResult;
	readonly endpointId: string;
	readonly vertical: boolean;
}): readonly number[] {
	const { layout, endpointId, vertical } = input;
	return layout.relations
		.filter(({ from }) => from === endpointId)
		.map(({ points }) => crossCoordinate(defined(points[0]), vertical))
		.sort((a, b) => a - b);
}

function portsFitFace(input: {
	readonly coordinates: readonly number[];
	readonly portCount: number;
	readonly start: number;
	readonly size: number;
}): boolean {
	const { coordinates, portCount, start, size } = input;
	if (new Set(coordinates).size !== portCount) return false;
	const first = defined(coordinates[0]);
	const last = defined(coordinates.at(-1));
	if (first - start < PORT_INSET) return false;
	if (start + size - last < PORT_INSET) return false;
	for (let index = 1; index < coordinates.length; index += 1) {
		const gap = defined(coordinates[index]) - defined(coordinates[index - 1]);
		if (gap < PORT_SPACING) return false;
	}
	return true;
}

function validateDemand(
	input: SourceFaceDemandInput,
	demand: LayoutContractCandidate['sourceFaceDemands'][number],
): SourceFaceDemandFailure | undefined {
	const { graph, candidate, layout, boxes, vertical } = input;
	if (!candidate.sourceOrder.includes(demand.endpointId))
		return SourceFaceDemandFailure.MetricDemand;
	const box = defined(boxes.get(demand.endpointId));
	const { start, size } = crossExtent(box, vertical);
	if (size < demand.minimumCrossSize) return SourceFaceDemandFailure.MetricDemand;
	const expectedCount = graph.relations.filter(
		({ relation }) => relation.from === demand.endpointId,
	).length;
	if (demand.portCount !== expectedCount) return SourceFaceDemandFailure.MetricDemand;
	const coordinates = outgoingCoordinates({
		layout,
		endpointId: demand.endpointId,
		vertical,
	});
	if (!portsFitFace({ coordinates, portCount: demand.portCount, start, size }))
		return SourceFaceDemandFailure.Ports;
	return undefined;
}

/** Checks the outgoing capacity chosen by the bounded independent materializer. */
export function validateSourceFaceDemands(
	input: SourceFaceDemandInput,
): SourceFaceDemandFailure | undefined {
	const { candidate } = input;
	const demands = candidate.sourceFaceDemands;
	if (demands.length !== candidate.sourceOrder.length) return SourceFaceDemandFailure.MetricDemand;
	const ids = new Set(demands.map(({ endpointId }) => endpointId));
	if (ids.size !== demands.length) return SourceFaceDemandFailure.MetricDemand;
	for (const demand of demands) {
		const failure = validateDemand(input, demand);
		if (failure !== undefined) return failure;
	}
	return undefined;
}
