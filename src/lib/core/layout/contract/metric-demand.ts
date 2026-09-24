import { defined, LayoutDirection } from '../../document/logic-document';
import type { GroupMeasurement, LayoutMeasurements, RoutingPortRole, Size } from '../layout-types';

/** Face-capacity demand already published by the adjacent-corridor contract. */
export interface FaceCapacityMetricDemand<Role extends RoutingPortRole = RoutingPortRole.Incoming> {
	readonly endpointId: string;
	readonly role: Role;
	readonly portCount: number;
	readonly minimumCrossSize: number;
	readonly growth: number;
}

export enum MetricDemandKind {
	MinimumEndpointExtent = 'minimum-endpoint-extent',
}

export enum MetricAxis {
	Width = 'width',
	Height = 'height',
}

/** A parent can reserve endpoint capacity before its child solves a local layout. */
export interface MinimumEndpointExtentMetricDemand {
	readonly kind: MetricDemandKind.MinimumEndpointExtent;
	readonly endpointId: string;
	readonly axis: MetricAxis;
	readonly minimum: number;
}

export type MetricDemand =
	FaceCapacityMetricDemand<RoutingPortRole> | MinimumEndpointExtentMetricDemand;

function demandAxis(demand: MetricDemand, direction: LayoutDirection): MetricAxis {
	if ('kind' in demand) return demand.axis;
	if (direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop)
		return MetricAxis.Width;
	return MetricAxis.Height;
}

function demandMinimum(demand: MetricDemand): number {
	if ('kind' in demand) return demand.minimum;
	return demand.minimumCrossSize;
}

interface MutableMeasurements {
	readonly nodes: Map<string, Size>;
	readonly junctions: Map<string, Size>;
	readonly groups: Map<string, GroupMeasurement>;
}

function enlargeEndpoint(
	measurements: MutableMeasurements,
	endpointId: string,
	axis: MetricAxis,
	minimum: number,
): void {
	const { nodes, junctions, groups } = measurements;
	const node = nodes.get(endpointId);
	if (node !== undefined) {
		nodes.set(endpointId, { ...node, [axis]: Math.max(node[axis], minimum) });
		return;
	}
	const junction = junctions.get(endpointId);
	if (junction !== undefined) {
		junctions.set(endpointId, { ...junction, [axis]: Math.max(junction[axis], minimum) });
		return;
	}
	const group = defined(groups.get(endpointId), `Unknown metric endpoint ${endpointId}`);
	if (axis === MetricAxis.Width)
		groups.set(endpointId, { ...group, minimumWidth: Math.max(group.minimumWidth, minimum) });
	else groups.set(endpointId, { ...group, minimumHeight: Math.max(group.minimumHeight, minimum) });
}

/** Apply compatible lower bounds without changing the caller's intrinsic measurements. */
export function satisfyMetricDemands(
	measurements: LayoutMeasurements,
	demands: readonly MetricDemand[],
	direction: LayoutDirection,
): LayoutMeasurements {
	if (demands.length === 0) return measurements;
	const enlarged = {
		nodes: new Map(measurements.nodes),
		junctions: new Map(measurements.junctions),
		groups: new Map(measurements.groups),
	};
	for (const demand of demands) {
		const axis = demandAxis(demand, direction);
		const minimum = demandMinimum(demand);
		if (!Number.isFinite(minimum) || minimum < 0)
			throw new Error(`Invalid metric demand for endpoint ${demand.endpointId}.`);
		enlargeEndpoint(enlarged, demand.endpointId, axis, minimum);
	}
	return enlarged;
}
