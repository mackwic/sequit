import { defined, EndpointKind, LaneOrientation } from '../document/logic-document';
import { RAIL_SPACING } from './layout-settings';
import {
	allocateCenteredTrack,
	type CenteredTrackAllocation,
	centeredTrackOffset,
	type RoutingTrackDemand,
} from './resources/routing-resource-allocation';
import { SHARED_LANE_CLEARANCE, type SharedLaneFrame } from './shared-lane-frame';
import type { SharedLaneEndpoint, SharedLaneInput } from './shared-lane-model';
import { incidenceKey, PortRole, type SharedLanePorts } from './shared-lane-ports';

function onlyMiddleObstacle(input: SharedLaneInput): SharedLaneEndpoint | undefined {
	const middle = [...input.endpoints.values()].filter(({ laneIndex }) => laneIndex === 1);
	if (middle.length === 0) return undefined;
	if (middle.length !== 1 || middle[0]?.kind !== EndpointKind.Group) return undefined;
	return middle[0];
}

/** The free rank gap between the two ports, optionally after a blocking empty group. */
function interiorPassageDemand(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
): RoutingTrackDemand | undefined {
	if (input.orientation !== LaneOrientation.Parallel) return undefined;
	if (!input.vertical || input.reverse) return undefined;
	if (input.laneIds.length !== 3 || input.plans.length !== 1) return undefined;
	const plan = defined(input.plans[0]);
	if (Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex) !== 2) return undefined;
	const source = defined(input.endpoints.get(plan.from));
	const target = defined(input.endpoints.get(plan.to));
	if (source.kind !== EndpointKind.Node || target.kind !== EndpointKind.Node) return undefined;
	if (source.row !== target.row + 1) return undefined;
	const obstacle = onlyMiddleObstacle(input);
	let expectedEndpointCount = 2;
	if (obstacle !== undefined) expectedEndpointCount = 3;
	if (input.endpoints.size !== expectedEndpointCount) return undefined;
	if (obstacle !== undefined && obstacle.row !== target.row) return undefined;
	const sourceBox = defined(frame.boxes.get(source.id));
	const targetBox = defined(frame.boxes.get(target.id));
	const sourcePort =
		sourceBox.longitudinal +
		sourceBox.longSize / 2 +
		defined(ports.offsetByIncidence.get(incidenceKey(plan.id, PortRole.Source)));
	const targetPort =
		targetBox.longitudinal +
		targetBox.longSize / 2 +
		defined(ports.offsetByIncidence.get(incidenceKey(plan.id, PortRole.Target)));
	let blockedUntil = targetBox.longitudinal + targetBox.longSize;
	if (obstacle !== undefined) {
		const box = defined(frame.boxes.get(obstacle.id));
		const boxEnd = box.longitudinal + box.longSize;
		if (targetPort < box.longitudinal || targetPort > boxEnd) return undefined;
		blockedUntil = Math.max(blockedUntil, boxEnd);
	}
	const first = blockedUntil + SHARED_LANE_CLEARANCE;
	const last = sourceBox.longitudinal - SHARED_LANE_CLEARANCE;
	if (first >= last || first <= targetPort) return undefined;
	if (last >= sourcePort) return undefined;
	return { relationId: plan.id, start: first, end: last };
}

/**
 * The interior passage as an allocation on its own edge: capacity one, centred in the free interval
 * between the two ports. The edge reserves no `edgeExtent`, because the space it uses is the empty
 * rank its lane already owns, which is why its centred track is off the frame's rail grid.
 */
export function interiorPassageAllocation(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
): CenteredTrackAllocation | undefined {
	const demand = interiorPassageDemand(input, frame, ports);
	if (demand === undefined) return undefined;
	return allocateCenteredTrack(
		{ ownerId: `${frame.ownerId}/interior`, capacity: 1, spacing: RAIL_SPACING },
		demand,
	);
}

/** The centred coordinate of the interior passage, undefined when the lane owns no free interval. */
export function interiorPassageTrack(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
): number | undefined {
	const allocation = interiorPassageAllocation(input, frame, ports);
	if (allocation === undefined) return undefined;
	return centeredTrackOffset(allocation);
}
