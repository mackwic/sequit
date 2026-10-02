import { defined } from '../../document/logic-document';
import type { LayoutRelation, Point } from '../layout-types';
import {
	allocateNestedTracks,
	type RoutingTrackAllocation,
	trackOffset,
} from '../resources/routing-resource-allocation';
import { physicalPoint, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { PortRole } from './shared-lane-ports';
import type { LogicalBox } from './shared-lane-types';
import type { TransverseLaneFrame } from './shared-transverse-frame';
import { directPlan, transversePortCross } from './shared-transverse-legs';

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

/**
 * How a transverse candidate routes its plans. The two direct orders join adjacent lanes across
 * the free interval between them; `Canonical` and `Nested` send every inter-lane plan through the
 * outer gutter corridor, the fallback when the validator refuses a direct route. A plan between
 * non-adjacent lanes always takes the corridor, on the tracks and side of the canonical or nested
 * allocation that its order names.
 */
export enum TransverseRouteOrder {
	Direct = 'direct',
	DirectNested = 'direct-nested',
	Canonical = 'canonical',
	Nested = 'nested',
}

function nestedOrder(order: TransverseRouteOrder): boolean {
	return order === TransverseRouteOrder.Nested || order === TransverseRouteOrder.DirectNested;
}

/**
 * The orders a transverse search evaluates. The gutter orders come first and keep the historical
 * routes (outer corridor, local U arcs), so the incident budget the candidates share never starves
 * them; the direct orders follow when a plan joins adjacent lanes or two rows of one lane, and are
 * otherwise not proposed, since each would route exactly like its gutter twin. The selection ranks
 * every evaluated candidate by bridges, length and bends.
 */
export function transverseRouteOrders(input: SharedLaneInput): readonly TransverseRouteOrder[] {
	const orders = [TransverseRouteOrder.Canonical, TransverseRouteOrder.Nested];
	const direct = input.plans.some(directPlan);
	if (direct) orders.push(TransverseRouteOrder.Direct, TransverseRouteOrder.DirectNested);
	return orders;
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
	const nested = nestedOrder(order);
	if (nested) ranked = [...input.plans].sort(compareLaneSpan);
	const ordinals = new Map<string, { readonly gutter: number; readonly rail: number }>();
	for (const [index, plan] of ranked.entries()) {
		let rail = index;
		if (nested) rail = ranked.length - index - 1;
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
	// A facing local plan crosses its row gap on its own leg; a U arc runs on the lane's rail.
	const track =
		frame.localLegByPlan.get(plan.id) ??
		exteriorTrack(frame, plan.sourceLaneIndex, plan.sourceSide, offset);
	return [ends.start, { x: ends.start.x, y: track }, { x: ends.end.x, y: track }, ends.end];
}

/**
 * Adjacent lanes face each other across the free interval between them: one segment when both
 * ports are aligned, otherwise a leg on the plan's rail track beside the source lane.
 */
function directPoints(
	ends: RouteEnds,
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
	railOffset: number,
): readonly Point[] {
	if (ends.start.x === ends.end.x) return [ends.start, ends.end];
	const track = exteriorTrack(frame, plan.sourceLaneIndex, plan.sourceSide, railOffset);
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

/**
 * The corridor side nearer the middle of both ports. With facing local faces (direct orders),
 * equally near sides are departed by the source port, so a passage leaves towards its own half of
 * the frame; the historical gutter order and a centred source keep the declared side.
 */
function nearestCorridorSide(
	ends: RouteEnds,
	plan: SharedLanePlan,
	frame: TransverseLaneFrame,
	bySourcePort: boolean,
): LaneSide {
	const center = frame.crossStart + frame.crossSize / 2;
	const midpoint = (ends.start.x + ends.end.x) / 2;
	if (midpoint < center) return -1;
	if (midpoint > center) return 1;
	if (bySourcePort && ends.start.x < center) return -1;
	if (bySourcePort && ends.start.x > center) return 1;
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
		x: transversePortCross(source, frame.portOffsetByIncidence, plan.id, PortRole.Source),
		y: longitudinalFace(source, plan.sourceSide),
	};
	const end = {
		x: transversePortCross(target, frame.portOffsetByIncidence, plan.id, PortRole.Target),
		y: longitudinalFace(target, plan.targetSide),
	};
	const ends = { start, end };
	if (plan.sameLane) return sameLanePoints(ends, plan, frame, choice.position.railOffset);
	const direct =
		choice.order === TransverseRouteOrder.Direct ||
		choice.order === TransverseRouteOrder.DirectNested;
	if (direct && directPlan(plan))
		return directPoints(ends, plan, frame, choice.position.railOffset);
	let side = plan.sourceSide;
	if (nestedOrder(choice.order))
		side = nearestCorridorSide(
			ends,
			plan,
			frame,
			choice.order === TransverseRouteOrder.DirectNested,
		);
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
