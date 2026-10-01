import { defined } from '../../document/logic-document';
import type { LayoutRelation, Point } from '../layout-types';
import {
	allocateNestedTracks,
	type RoutingTrackAllocation,
	trackOffset,
} from '../resources/routing-resource-allocation';
import { physicalPoint, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole } from './shared-lane-ports';
import type { LogicalBox } from './shared-lane-types';
import type { TransverseLaneFrame } from './shared-transverse-frame';

function portCross(
	box: LogicalBox,
	relationId: string,
	role: PortRole,
	frame: TransverseLaneFrame,
): number {
	const offset = defined(frame.portOffsetByIncidence.get(incidenceKey(relationId, role)));
	return box.cross + box.crossSize / 2 + offset;
}

function longitudinalFace(box: LogicalBox, side: LaneSide): number {
	if (side === 1) return box.longitudinal + box.longSize;
	return box.longitudinal;
}

function exteriorTrack(
	frame: TransverseLaneFrame,
	laneIndex: number,
	side: LaneSide,
	offset: number,
): number {
	const start = defined(frame.laneLongStarts[laneIndex]);
	if (side === -1) return start - offset;
	return start + defined(frame.laneLongSizes[laneIndex]) + offset;
}

function gutterCross(frame: TransverseLaneFrame, side: LaneSide, offset: number): number {
	if (side === -1) return frame.crossStart - offset;
	return frame.crossStart + frame.crossSize + offset;
}

interface RouteEnds {
	readonly start: Point;
	readonly end: Point;
}

export enum TransverseRouteOrder {
	Canonical = 'canonical',
	Nested = 'nested',
}

/** The tracks one plan's route reads: the gutter corridor offset and the rail offset it was granted. */
interface RoutePosition {
	readonly gutterOffset: number;
	readonly railOffset: number;
}

interface RouteChoice {
	readonly position: RoutePosition;
	readonly order: TransverseRouteOrder;
}

interface CorridorPosition {
	readonly side: LaneSide;
	readonly gutterOffset: number;
	readonly railOffset: number;
}

/** The tracks a transverse lane frame routes on: the shared gutter corridor and the lane rails. */
export interface TransverseRouteAllocation {
	readonly gutter: RoutingTrackAllocation;
	readonly rail: RoutingTrackAllocation;
}

/** Stable plan-order ties keep nested ordinals independent of relation IDs. */
function compareLaneSpan(left: SharedLanePlan, right: SharedLanePlan): number {
	const spanLeft = Math.abs(left.sourceLaneIndex - left.targetLaneIndex);
	const spanRight = Math.abs(right.sourceLaneIndex - right.targetLaneIndex);
	return spanLeft - spanRight;
}

/** The declared ordinal of both transverse bands of one plan, in documentary plan order. */
function declaredOrdinals(
	input: SharedLaneInput,
	order: TransverseRouteOrder,
): ReadonlyMap<string, { readonly gutter: number; readonly rail: number }> {
	let ranked: readonly SharedLanePlan[] = input.plans;
	if (order === TransverseRouteOrder.Nested) ranked = [...input.plans].sort(compareLaneSpan);
	const ordinals = new Map<string, { readonly gutter: number; readonly rail: number }>();
	for (const [index, plan] of ranked.entries()) {
		let rail = index;
		if (order === TransverseRouteOrder.Nested) rail = ranked.length - index - 1;
		ordinals.set(plan.id, { gutter: index, rail });
	}
	return ordinals;
}

export interface TransverseRouteTrackOverrides {
	readonly gutter?: RoutingTrackAllocation;
	readonly rail?: RoutingTrackAllocation;
}

/**
 * The transverse allocation: every plan owns its declared track on the shared gutter corridor and
 * on the lane rails. Canonical order preserves documentary plan order; nested order groups by lane
 * span, read in opposite directions so the plan with the innermost gutter track takes the outermost
 * rail track. Every demand declares the frame's whole longitudinal extent, so the declared ordinal
 * orders it and no interval containment can move it.
 */
export function allocateTransverseRoutes(
	input: SharedLaneInput,
	frame: TransverseLaneFrame,
	order: TransverseRouteOrder,
	overrides?: TransverseRouteTrackOverrides,
): TransverseRouteAllocation {
	if (overrides?.gutter !== undefined && overrides.rail !== undefined)
		return { gutter: overrides.gutter, rail: overrides.rail };
	const ordinals = declaredOrdinals(input, order);
	const ranked = input.plans.map((plan) => ({ plan, ordinal: defined(ordinals.get(plan.id)) }));
	const demandOf = (plan: SharedLanePlan, declaredOrder: number) => ({
		key: plan.id,
		start: 0,
		end: frame.longExtent,
		order: declaredOrder,
	});
	return {
		gutter:
			overrides?.gutter ??
			allocateNestedTracks(
				frame.gutterEdge,
				ranked.map(({ plan, ordinal }) => demandOf(plan, ordinal.gutter)),
			),
		rail:
			overrides?.rail ??
			allocateNestedTracks(
				frame.railEdge,
				ranked.map(({ plan, ordinal }) => demandOf(plan, ordinal.rail)),
			),
	};
}

function sameLanePoints(
	ends: RouteEnds,
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
	offset: number,
): readonly Point[] {
	const track = exteriorTrack(frame, plan.sourceLaneIndex, plan.sourceSide, offset);
	return [ends.start, { x: ends.start.x, y: track }, { x: ends.end.x, y: track }, ends.end];
}

function crossLanePoints(
	ends: RouteEnds,
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
	position: CorridorPosition,
): readonly Point[] {
	const sourceTrack = exteriorTrack(
		frame,
		plan.sourceLaneIndex,
		plan.sourceSide,
		position.railOffset,
	);
	const targetTrack = exteriorTrack(
		frame,
		plan.targetLaneIndex,
		plan.targetSide,
		position.railOffset,
	);
	const gutter = gutterCross(frame, position.side, position.gutterOffset);
	return [
		ends.start,
		{ x: ends.start.x, y: sourceTrack },
		{ x: gutter, y: sourceTrack },
		{ x: gutter, y: targetTrack },
		{ x: ends.end.x, y: targetTrack },
		ends.end,
	];
}

function nearestCorridorSide(
	ends: RouteEnds,
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
): LaneSide {
	const center = frame.crossStart + frame.crossSize / 2;
	const midpoint = (ends.start.x + ends.end.x) / 2;
	if (midpoint < center) return -1;
	if (midpoint > center) return 1;
	return plan.sourceSide;
}

function logicalRoute(
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
	choice: RouteChoice,
): readonly Point[] {
	const source = defined(frame.boxes.get(plan.from));
	const target = defined(frame.boxes.get(plan.to));
	const start = {
		x: portCross(source, plan.id, PortRole.Source, frame),
		y: longitudinalFace(source, plan.sourceSide),
	};
	const end = {
		x: portCross(target, plan.id, PortRole.Target, frame),
		y: longitudinalFace(target, plan.targetSide),
	};
	const ends = { start, end };
	if (plan.sameLane) return sameLanePoints(ends, plan, frame, choice.position.railOffset);
	let side = plan.sourceSide;
	if (choice.order === TransverseRouteOrder.Nested) side = nearestCorridorSide(ends, plan, frame);
	return crossLanePoints(ends, plan, frame, {
		side,
		gutterOffset: choice.position.gutterOffset,
		railOffset: choice.position.railOffset,
	});
}

/** The granted corridor and rail offsets of one plan's route. */
function routePosition(allocation: TransverseRouteAllocation, plan: SharedLanePlan): RoutePosition {
	return {
		gutterOffset:
			SHARED_LANE_CLEARANCE +
			trackOffset(allocation.gutter.edge, defined(allocation.gutter.trackByKey.get(plan.id))),
		railOffset:
			SHARED_LANE_CLEARANCE +
			trackOffset(allocation.rail.edge, defined(allocation.rail.trackByKey.get(plan.id))),
	};
}

/** The route of every plan of the frame, in documentary plan order. */
export function routeTransverseLanes(
	input: SharedLaneInput,
	frame: TransverseLaneFrame,
	allocation: TransverseRouteAllocation,
	order: TransverseRouteOrder = TransverseRouteOrder.Canonical,
): readonly LayoutRelation[] {
	return input.plans.map((plan) => {
		const points = logicalRoute(plan, frame, {
			position: routePosition(allocation, plan),
			order,
		});
		return {
			id: plan.id,
			from: plan.from,
			to: plan.to,
			points: points.map((point) => physicalPoint(point, input, frame.longExtent)),
		};
	});
}
