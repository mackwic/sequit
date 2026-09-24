import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { RAIL_SPACING } from './layout-settings';
import type { LayoutRelation, Point } from './layout-types';
import {
	type LogicalBox,
	physicalPoint,
	SHARED_LANE_CLEARANCE,
	type SharedLaneFrame,
} from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole, type SharedLanePorts } from './shared-lane-ports';

function portLong(
	box: LogicalBox,
	relationId: string,
	role: PortRole,
	ports: SharedLanePorts,
): number {
	const offset = defined(ports.offsetByIncidence.get(incidenceKey(relationId, role)));
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

interface RoutePosition {
	readonly passageIndex: number;
	readonly gutterIndex: number;
	readonly order: ParallelRouteOrder;
	readonly interiorTrack?: number;
}

interface RouteChoice {
	readonly order: ParallelRouteOrder;
	readonly interiorTrack?: number;
}

export enum ParallelRouteOrder {
	Canonical = 'canonical',
	LocalPassages = 'local-passages',
	ReservedTopPassage = 'reserved-top-passage',
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

function passageTrack(
	frame: SharedLaneFrame,
	position: RoutePosition,
	sourceLong: number,
	targetLong: number,
): number {
	if (position.interiorTrack !== undefined) return position.interiorTrack;
	if (position.order === ParallelRouteOrder.ReservedTopPassage)
		return frame.topExteriorBase + position.passageIndex * RAIL_SPACING;
	if (position.order === ParallelRouteOrder.LocalPassages) {
		const contentMidpoint = (frame.contentLongStart + frame.contentLongEnd) / 2;
		const routeMidpoint = (sourceLong + targetLong) / 2;
		if (routeMidpoint < contentMidpoint)
			return frame.topExteriorBase + position.passageIndex * RAIL_SPACING;
	}
	return frame.exteriorBase + position.passageIndex * RAIL_SPACING;
}

function logicalPoints(
	plan: SharedLanePlan,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
	position: RoutePosition,
): readonly Point[] {
	const source = defined(frame.boxes.get(plan.from));
	const target = defined(frame.boxes.get(plan.to));
	const sourceLong = portLong(source, plan.id, PortRole.Source, ports);
	const targetLong = portLong(target, plan.id, PortRole.Target, ports);
	const offset = SHARED_LANE_CLEARANCE + (position.gutterIndex + 1) * RAIL_SPACING;
	const sourceGutter = gutter(frame, plan.sourceLaneIndex, plan.sourceSide, offset);
	const targetGutter = gutter(frame, plan.targetLaneIndex, plan.targetSide, offset);
	const start = { x: face(source, plan.sourceSide), y: sourceLong };
	const end = { x: face(target, plan.targetSide), y: targetLong };
	if (plan.sameLane)
		return [start, { x: sourceGutter, y: sourceLong }, { x: sourceGutter, y: targetLong }, end];
	const laneSpan = Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex);
	if (position.order === ParallelRouteOrder.LocalPassages && laneSpan === 1)
		return adjacentPoints(start, end, sourceGutter, targetGutter);
	const track = passageTrack(frame, position, sourceLong, targetLong);
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

function routesForOrder(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
	choice: RouteChoice,
): readonly LayoutRelation[] {
	const routes: LayoutRelation[] = [];
	for (const [gutterIndex, plan] of canonicalPlans(input).entries()) {
		const passageIndex = frame.crossLanePlans.findIndex(({ id }) => id === plan.id);
		let position: RoutePosition = {
			passageIndex,
			gutterIndex,
			order: choice.order,
		};
		if (choice.interiorTrack !== undefined)
			position = { ...position, interiorTrack: choice.interiorTrack };
		const points = logicalPoints(plan, frame, ports, position);
		routes.push({
			id: plan.id,
			from: plan.from,
			to: plan.to,
			points: points.map((point) => physicalPoint(point, input, frame.longExtent)),
		});
	}
	return routes;
}

export function routeSharedLanes(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
	order: ParallelRouteOrder = ParallelRouteOrder.Canonical,
): readonly LayoutRelation[] {
	return routesForOrder(input, frame, ports, { order });
}

export function routeSharedLaneThroughInterior(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	ports: SharedLanePorts,
	track: number,
): readonly LayoutRelation[] {
	return routesForOrder(input, frame, ports, {
		order: ParallelRouteOrder.Canonical,
		interiorTrack: track,
	});
}
