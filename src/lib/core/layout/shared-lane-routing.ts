import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import type { LayoutRelation, Point } from './layout-types';
import {
	allocateNestedTracks,
	type CenteredTrackAllocation,
	centeredTrackOffset,
	type RoutingTrackAllocation,
	trackOffset,
} from './routing-resource-allocation';
import {
	type LogicalBox,
	physicalPoint,
	SHARED_LANE_CLEARANCE,
	type SharedLaneFrame,
} from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';

function portLong(
	box: LogicalBox,
	relationId: string,
	role: PortRole,
	frame: SharedLaneFrame,
): number {
	const offset = defined(frame.portOffsetByIncidence.get(incidenceKey(relationId, role)));
	return box.longitudinal + box.longSize / 2 + offset;
}

function face(box: LogicalBox, side: LaneSide): number {
	if (side === 1) return box.cross + box.crossSize;
	return box.cross;
}

function gutter(
	frame: SharedLaneFrame,
	laneIndex: number,
	side: LaneSide,
	gutterOffset: number,
): number {
	const start = defined(frame.laneStarts[laneIndex]);
	if (side === -1) return start - gutterOffset;
	return start + defined(frame.laneWidths[laneIndex]) + gutterOffset;
}

/** The tracks one plan's route reads: the gutter offset it was granted, its ports and its order. */
interface RoutePosition {
	readonly gutterOffset: number;
	readonly sourceLong: number;
	readonly targetLong: number;
	readonly order: ParallelRouteOrder;
}

/** The tracks a parallel lane frame routes on: its gutter band, both rails and its interior passage. */
export interface ParallelRouteAllocation {
	readonly gutter: RoutingTrackAllocation;
	readonly exteriorRail: RoutingTrackAllocation;
	readonly topExteriorRail: RoutingTrackAllocation;
	/** The passage that replaces the rail of a route when the geometry declares one. */
	readonly passage?: CenteredTrackAllocation;
}

export enum ParallelRouteOrder {
	Canonical = 'canonical',
	LocalPassages = 'local-passages',
	ReservedTopPassage = 'reserved-top-passage',
}

/**
 * The canonical parallel allocation: every plan owns its canonical gutter track — both gutters of a
 * plan share the ordinal, as the frame has always placed them — and every relation that crosses a
 * lane owns its declared rail track, the rank of its plan in the crossing order the frame publishes.
 * A rail demand declares the frame's whole content extent, so the declared ordinal orders it and no
 * interval containment can move it off the rank the placement reserved.
 */
export function allocateParallelRoutes(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
): ParallelRouteAllocation {
	const crossingDemands = frame.crossLanePlans.map((plan, order) => ({
		relationId: plan.id,
		start: frame.contentLongStart,
		end: frame.contentLongEnd,
		order,
	}));
	return {
		gutter: allocateNestedTracks(
			frame.gutterEdge,
			input.plans.map((plan) => ({
				relationId: plan.id,
				start: frame.contentLongStart,
				end: frame.contentLongEnd,
			})),
		),
		exteriorRail: allocateNestedTracks(frame.exteriorRailEdge, crossingDemands),
		topExteriorRail: allocateNestedTracks(frame.topExteriorRailEdge, crossingDemands),
	};
}

function adjacentPoints(
	start: Point,
	end: Point,
	sourceGutter: number,
	targetGutter: number,
): readonly Point[] {
	if (start.y === end.y)
		return [start, { x: sourceGutter, y: start.y }, { x: targetGutter, y: end.y }, end];
	return [
		start,
		{ x: sourceGutter, y: start.y },
		{ x: sourceGutter, y: end.y },
		{ x: targetGutter, y: end.y },
		end,
	];
}

/** The rail offset of a crossing plan, on the rail edge the route order selects. */
function railOffset(allocation: RoutingTrackAllocation, plan: SharedLanePlan): number {
	return trackOffset(allocation.edge, defined(allocation.trackByRelationId.get(plan.id)));
}

function passageTrack(
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	plan: SharedLanePlan,
	position: RoutePosition,
): number {
	const { passage } = allocation;
	if (passage !== undefined) return centeredTrackOffset(passage);
	if (position.order === ParallelRouteOrder.ReservedTopPassage)
		return frame.topExteriorBase + railOffset(allocation.topExteriorRail, plan);
	if (position.order === ParallelRouteOrder.LocalPassages) {
		const contentMidpoint = (frame.contentLongStart + frame.contentLongEnd) / 2;
		const routeMidpoint = (position.sourceLong + position.targetLong) / 2;
		if (routeMidpoint < contentMidpoint)
			return frame.topExteriorBase + railOffset(allocation.topExteriorRail, plan);
	}
	return frame.exteriorBase + railOffset(allocation.exteriorRail, plan);
}

function logicalPoints(
	plan: SharedLanePlan,
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	position: RoutePosition,
): readonly Point[] {
	const source = defined(frame.boxes.get(plan.from));
	const target = defined(frame.boxes.get(plan.to));
	const { sourceLong, targetLong, gutterOffset } = position;
	const sourceGutter = gutter(frame, plan.sourceLaneIndex, plan.sourceSide, gutterOffset);
	const targetGutter = gutter(frame, plan.targetLaneIndex, plan.targetSide, gutterOffset);
	const start = { x: face(source, plan.sourceSide), y: sourceLong };
	const end = { x: face(target, plan.targetSide), y: targetLong };
	if (plan.sameLane)
		return [start, { x: sourceGutter, y: sourceLong }, { x: sourceGutter, y: targetLong }, end];
	const laneSpan = Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex);
	if (position.order === ParallelRouteOrder.LocalPassages && laneSpan === 1)
		return adjacentPoints(start, end, sourceGutter, targetGutter);
	const track = passageTrack(frame, allocation, plan, position);
	return [
		start,
		{ x: sourceGutter, y: sourceLong },
		{ x: sourceGutter, y: track },
		{ x: targetGutter, y: track },
		{ x: targetGutter, y: targetLong },
		end,
	];
}

function canonicalPlans(input: SharedLaneInput): readonly SharedLanePlan[] {
	return [...input.plans].sort((a, b) => compareCanonicalStrings(a.id, b.id));
}

/** The granted gutter track, the ports and the order of one plan's route. */
function routePosition(
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	plan: SharedLanePlan,
	order: ParallelRouteOrder,
): RoutePosition {
	const gutterTrack = defined(allocation.gutter.trackByRelationId.get(plan.id));
	return {
		gutterOffset: SHARED_LANE_CLEARANCE + trackOffset(allocation.gutter.edge, gutterTrack),
		sourceLong: portLong(defined(frame.boxes.get(plan.from)), plan.id, PortRole.Source, frame),
		targetLong: portLong(defined(frame.boxes.get(plan.to)), plan.id, PortRole.Target, frame),
		order,
	};
}

/** The route of every plan of the frame, in the canonical plan order. */
export function routeSharedLanes(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	order: ParallelRouteOrder = ParallelRouteOrder.Canonical,
): readonly LayoutRelation[] {
	const routes: LayoutRelation[] = [];
	for (const plan of canonicalPlans(input)) {
		const points = logicalPoints(
			plan,
			frame,
			allocation,
			routePosition(frame, allocation, plan, order),
		);
		routes.push({
			id: plan.id,
			from: plan.from,
			to: plan.to,
			points: points.map((point) => physicalPoint(point, input, frame.longExtent)),
		});
	}
	return routes;
}
