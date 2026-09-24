import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { RAIL_SPACING } from './layout-settings';
import type { LayoutRelation, Point } from './layout-types';
import { type LogicalBox, physicalPoint, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import type { LaneSide, SharedLaneInput, SharedLanePlan } from './shared-lane-model';
import { incidenceKey, PortRole, type SharedLanePorts } from './shared-lane-ports';
import type { TransverseLaneFrame } from './shared-transverse-frame';

function portCross(
	box: LogicalBox,
	relationId: string,
	role: PortRole,
	ports: SharedLanePorts,
): number {
	const offset = defined(ports.offsetByIncidence.get(incidenceKey(relationId, role)));
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

interface RoutePosition {
	readonly gutterIndex: number;
	readonly trackIndex: number;
}

interface RouteChoice {
	readonly position: RoutePosition;
	readonly order: TransverseRouteOrder;
}

interface CorridorPosition {
	readonly side: LaneSide;
	readonly gutterOffset: number;
	readonly trackOffset: number;
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
		position.trackOffset,
	);
	const targetTrack = exteriorTrack(
		frame,
		plan.targetLaneIndex,
		plan.targetSide,
		position.trackOffset,
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
	ports: SharedLanePorts,
	choice: RouteChoice,
): readonly Point[] {
	const source = defined(frame.boxes.get(plan.from));
	const target = defined(frame.boxes.get(plan.to));
	const start = {
		x: portCross(source, plan.id, PortRole.Source, ports),
		y: longitudinalFace(source, plan.sourceSide),
	};
	const end = {
		x: portCross(target, plan.id, PortRole.Target, ports),
		y: longitudinalFace(target, plan.targetSide),
	};
	const gutterOffset = SHARED_LANE_CLEARANCE + (choice.position.gutterIndex + 1) * RAIL_SPACING;
	const trackOffset = SHARED_LANE_CLEARANCE + (choice.position.trackIndex + 1) * RAIL_SPACING;
	const ends = { start, end };
	if (plan.sameLane) return sameLanePoints(ends, plan, frame, trackOffset);
	let side = plan.sourceSide;
	if (choice.order === TransverseRouteOrder.Nested) side = nearestCorridorSide(ends, plan, frame);
	return crossLanePoints(ends, plan, frame, { side, gutterOffset, trackOffset });
}

function nestedPositions(input: SharedLaneInput): ReadonlyMap<string, RoutePosition> {
	const ordered = [...input.plans].sort((a, b) => {
		const spanA = Math.abs(a.sourceLaneIndex - a.targetLaneIndex);
		const spanB = Math.abs(b.sourceLaneIndex - b.targetLaneIndex);
		if (spanA !== spanB) return spanA - spanB;
		return compareCanonicalStrings(a.id, b.id);
	});
	const positions = new Map<string, RoutePosition>();
	for (const [index, plan] of ordered.entries()) {
		positions.set(plan.id, {
			gutterIndex: index,
			trackIndex: ordered.length - index - 1,
		});
	}
	return positions;
}

export function routeTransverseLanes(
	input: SharedLaneInput,
	frame: TransverseLaneFrame,
	ports: SharedLanePorts,
	order: TransverseRouteOrder = TransverseRouteOrder.Canonical,
): readonly LayoutRelation[] {
	const plans = [...input.plans].sort((a, b) => compareCanonicalStrings(a.id, b.id));
	let positions: ReadonlyMap<string, RoutePosition> | undefined;
	if (order === TransverseRouteOrder.Nested) positions = nestedPositions(input);
	return plans.map((plan, index) => ({
		id: plan.id,
		from: plan.from,
		to: plan.to,
		points: logicalRoute(plan, frame, ports, {
			position: positions?.get(plan.id) ?? { gutterIndex: index, trackIndex: index },
			order,
		}).map((point) => physicalPoint(point, input, frame.longExtent)),
	}));
}
