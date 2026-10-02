import { defined } from '../../document/logic-document';
import { RAIL_SPACING } from '../layout-settings';
import type { LayoutRelation, Point } from '../layout-types';
import {
	allocateNestedTracks,
	type CenteredTrackAllocation,
	centeredTrackOffset,
	type RoutingTrackAllocation,
	trackOffset,
} from '../resources/routing-resource-allocation';
import type { PortAccess } from './shared-lane-bands';
import { physicalPoint, SHARED_LANE_CLEARANCE, type SharedLaneFrame } from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';

function portAccess(frame: SharedLaneFrame, relationId: string, role: PortRole): PortAccess {
	return defined(frame.portAccessByIncidence.get(incidenceKey(relationId, role)));
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
	readonly source: PortAccess;
	readonly target: PortAccess;
	readonly order: ParallelRouteOrder;
}

/** The tracks a parallel lane frame routes on: its gutter band, both rails and its interior passage. */
export interface ParallelRouteAllocation {
	readonly gutter: RoutingTrackAllocation;
	readonly exteriorRail: RoutingTrackAllocation;
	readonly topExteriorRail: RoutingTrackAllocation;
	readonly mainTrackByPlan: ReadonlyMap<string, number>;
	/** The passage that replaces the rail of a route when the geometry declares one. */
	readonly passage?: CenteredTrackAllocation;
}

export enum ParallelRouteOrder {
	Canonical = 'canonical',
	LocalPassages = 'local-passages',
	ReservedTopPassage = 'reserved-top-passage',
}

export interface ParallelRouteTrackOverrides {
	readonly gutter?: RoutingTrackAllocation;
	readonly railTrackByKey?: ReadonlyMap<string, number>;
}

function mainPassageTracks(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
): ReadonlyMap<string, number> {
	const groups = new Map<string, SharedLanePlan[]>();
	for (const plan of input.plans) {
		if (!frame.mainFacePlanIds.has(plan.id)) continue;
		const row = defined(input.endpoints.get(plan.from)).row;
		const key = JSON.stringify([plan.sourceLaneIndex, row]);
		const group = groups.get(key) ?? [];
		group.push(plan);
		groups.set(key, group);
	}
	const tracks = new Map<string, number>();
	for (const plans of groups.values()) {
		const demands = plans
			.map((plan, order) => {
				const start = defined(portAccess(frame, plan.id, PortRole.Source).points[0]);
				const end = defined(portAccess(frame, plan.id, PortRole.Target).points[0]);
				return { plan, start, end, order, span: Math.abs(start.x - end.x) };
			})
			.sort((a, b) => a.span - b.span || a.order - b.order);
		const first = defined(demands[0]);
		const direction = Math.sign(first.end.y - first.start.y);
		let anchor = Math.min(...demands.map(({ start }) => start.y));
		if (direction > 0) anchor = Math.max(...demands.map(({ start }) => start.y));
		for (const [index, { plan }] of demands.entries()) {
			const offset = SHARED_LANE_CLEARANCE + index * RAIL_SPACING;
			tracks.set(plan.id, anchor + direction * offset);
		}
	}
	return tracks;
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
	overrides?: ParallelRouteTrackOverrides,
): ParallelRouteAllocation {
	const crossingDemands = frame.crossLanePlans.map((plan, order) => ({
		key: plan.id,
		start: frame.contentLongStart,
		end: frame.contentLongEnd,
		order,
	}));
	const gutter =
		overrides?.gutter ??
		allocateNestedTracks(
			frame.gutterEdge,
			input.plans.map((plan, order) => ({
				key: plan.id,
				start: frame.contentLongStart,
				end: frame.contentLongEnd,
				order,
			})),
		);
	const railTracks = overrides?.railTrackByKey;
	let exteriorRail: RoutingTrackAllocation;
	let topExteriorRail: RoutingTrackAllocation;
	if (railTracks === undefined) {
		exteriorRail = allocateNestedTracks(frame.exteriorRailEdge, crossingDemands);
		topExteriorRail = allocateNestedTracks(frame.topExteriorRailEdge, crossingDemands);
	} else {
		exteriorRail = { edge: frame.exteriorRailEdge, trackByKey: railTracks };
		topExteriorRail = { edge: frame.topExteriorRailEdge, trackByKey: railTracks };
	}
	return {
		gutter,
		exteriorRail,
		topExteriorRail,
		mainTrackByPlan: mainPassageTracks(input, frame),
	};
}

function adjacentPoints(
	sourceLong: number,
	targetLong: number,
	sourceGutter: number,
	targetGutter: number,
): readonly Point[] {
	if (sourceLong === targetLong)
		return [
			{ x: sourceGutter, y: sourceLong },
			{ x: targetGutter, y: targetLong },
		];
	return [
		{ x: sourceGutter, y: sourceLong },
		{ x: sourceGutter, y: targetLong },
		{ x: targetGutter, y: targetLong },
	];
}

/** The rail offset of a crossing plan, on the rail edge the route order selects. */
function railOffset(allocation: RoutingTrackAllocation, plan: SharedLanePlan): number {
	return trackOffset(allocation.edge, defined(allocation.trackByKey.get(plan.id)));
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
		const routeMidpoint = (position.source.reach + position.target.reach) / 2;
		if (routeMidpoint < contentMidpoint)
			return frame.topExteriorBase + railOffset(allocation.topExteriorRail, plan);
	}
	return frame.exteriorBase + railOffset(allocation.exteriorRail, plan);
}
export function routeRailTrack(
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	plan: SharedLanePlan,
	order: ParallelRouteOrder,
): number | undefined {
	if (allocation.passage !== undefined) return undefined;
	if (plan.sameLane) return undefined;
	const laneSpan = Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex);
	if (order === ParallelRouteOrder.LocalPassages && laneSpan === 1) return undefined;
	const position = routePosition(frame, allocation, plan, order);
	let rail = allocation.exteriorRail;
	if (order === ParallelRouteOrder.ReservedTopPassage) rail = allocation.topExteriorRail;
	if (order === ParallelRouteOrder.LocalPassages) {
		const contentMidpoint = (frame.contentLongStart + frame.contentLongEnd) / 2;
		const routeMidpoint = (position.source.reach + position.target.reach) / 2;
		if (routeMidpoint < contentMidpoint) rail = allocation.topExteriorRail;
	}
	return rail.trackByKey.get(plan.id);
}

/** The gutter part of a route, between the gutter entries of its two ports. */
function gutterPoints(
	plan: SharedLanePlan,
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	position: RoutePosition,
): readonly Point[] {
	const sourceLong = position.source.reach;
	const targetLong = position.target.reach;
	const { gutterOffset } = position;
	const sourceGutter = gutter(frame, plan.sourceLaneIndex, plan.sourceSide, gutterOffset);
	const targetGutter = gutter(frame, plan.targetLaneIndex, plan.targetSide, gutterOffset);
	if (plan.sameLane)
		return [
			{ x: sourceGutter, y: sourceLong },
			{ x: sourceGutter, y: targetLong },
		];
	const laneSpan = Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex);
	if (position.order === ParallelRouteOrder.LocalPassages && laneSpan === 1)
		return adjacentPoints(sourceLong, targetLong, sourceGutter, targetGutter);
	const track = passageTrack(frame, allocation, plan, position);
	return [
		{ x: sourceGutter, y: sourceLong },
		{ x: sourceGutter, y: track },
		{ x: targetGutter, y: track },
		{ x: targetGutter, y: targetLong },
	];
}

/** Main-face ports meet in the free passage between consecutive rows, without a gutter. */
function mainFacePoints(position: RoutePosition, middle: number): readonly Point[] {
	const start = defined(position.source.points[0]);
	const end = defined(position.target.points[0]);
	if (start.x === end.x) return [start, end];
	return [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
}

/** A route leaves its source port, follows the gutters and enters its target port the same way. */
function logicalPoints(
	plan: SharedLanePlan,
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	position: RoutePosition,
): readonly Point[] {
	return [
		...position.source.points,
		...gutterPoints(plan, frame, allocation, position),
		...position.target.points.toReversed(),
	];
}

/** The granted gutter track, the ports and the order of one plan's route. */
function routePosition(
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	plan: SharedLanePlan,
	order: ParallelRouteOrder,
): RoutePosition {
	const gutterTrack = defined(allocation.gutter.trackByKey.get(plan.id));
	return {
		gutterOffset: SHARED_LANE_CLEARANCE + trackOffset(allocation.gutter.edge, gutterTrack),
		source: portAccess(frame, plan.id, PortRole.Source),
		target: portAccess(frame, plan.id, PortRole.Target),
		order,
	};
}

export interface SharedLaneRouteRequest {
	readonly input: SharedLaneInput;
	readonly frame: SharedLaneFrame;
	readonly allocation: ParallelRouteAllocation;
	readonly order: ParallelRouteOrder;
	readonly plan: SharedLanePlan;
}

/** Materialize one route after its gutter or rail assignment changes. */
export function routeSharedLane({
	input,
	frame,
	allocation,
	order,
	plan,
}: SharedLaneRouteRequest): LayoutRelation {
	const position = routePosition(frame, allocation, plan, order);
	let points: readonly Point[];
	if (frame.mainFacePlanIds.has(plan.id))
		points = mainFacePoints(position, defined(allocation.mainTrackByPlan.get(plan.id)));
	else points = logicalPoints(plan, frame, allocation, position);
	return {
		id: plan.id,
		from: plan.from,
		to: plan.to,
		points: points.map((point) => physicalPoint(point, input, frame.longExtent)),
	};
}

/** The route of every plan of the frame, in documentary plan order. */
export function routeSharedLanes(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	allocation: ParallelRouteAllocation,
	order: ParallelRouteOrder = ParallelRouteOrder.Canonical,
): readonly LayoutRelation[] {
	return input.plans.map((plan) => routeSharedLane({ input, frame, allocation, order, plan }));
}
