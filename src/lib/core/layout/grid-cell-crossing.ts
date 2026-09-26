import { compareCanonicalStrings } from '../canonical-string';
import { defined, type LogicRelation } from '../document/logic-document';
import {
	MetricAxis,
	MetricDemandKind,
	type MinimumEndpointExtentMetricDemand,
} from './contract/metric-demand';
import { equal } from './grid-cell-geometry-primitives';
import type { Bounds, LayoutRelation, Point } from './layout-types';
import { RegionPortalSide } from './region-composition-types';
import { edgeExtent, type RoutingEdge, trackOffset } from './routing-resource-allocation';

const PORT_INSET = 16;
/** Clearance between two adjacent crossing tracks. */
export const CROSSING_SPACING = 24;
/** Distance from the grid frame to the first rail track. */
const OUTER_RAIL_OFFSET = 48;
/** Distance from the canvas top to the first bus track. */
const TOP_BUS_Y = 24;

/** The rail edge's anchor is one crossing track inboard of its first track. */
const RAIL_ANCHOR_OFFSET = OUTER_RAIL_OFFSET - CROSSING_SPACING;
/** The bus edge's anchor is the canvas top edge; TOP_BUS_Y is its first track. */
const BUS_ANCHOR_Y = TOP_BUS_Y - CROSSING_SPACING;

/** The declared routing edges of one grid region. */
export interface GridRoutingEdges {
	/**
	 * One vertical gutter edge per column, in column order. A column exits through its gutter: the
	 * gutters of the leading columns sit between two columns, the last sits on the right frame.
	 */
	readonly gutters: readonly RoutingEdge[];
	readonly topBus: RoutingEdge;
	/** Total crossings the frame margin and every gutter reserve track space for. */
	readonly crossingCount: number;
}

/**
 * Gutters and bus of one grid region. Every gutter owns the crossing tracks plus one outermost
 * track: that reserved track is the one the margin pays for, and an inherited incident uses it to
 * leave the grid without entering the crossing tracks. The last gutter sits on the right frame, so
 * the leading columns all leave towards the left.
 */
export function gridRoutingEdges(
	regionId: string,
	columnCount: number,
	crossingCount: number,
): GridRoutingEdges {
	const gutter: RoutingEdge = {
		ownerId: regionId,
		capacity: crossingCount + 1,
		spacing: CROSSING_SPACING,
	};
	return {
		gutters: Array.from({ length: Math.max(1, columnCount) }, () => gutter),
		topBus: { ...gutter, capacity: crossingCount },
		crossingCount,
	};
}

/** The outermost gutter track: reserved for an inherited incident or an added crossing track. */
export function reservedRailTrack(edge: RoutingEdge): number {
	return edge.capacity - 1;
}

/**
 * The margin one frame edge reserves: OUTER_RAIL_OFFSET clear of the first crossing track, plus one
 * CROSSING_SPACING per additional crossing track. The far OUTER_RAIL_OFFSET covers the reserved
 * track and its clearance, so no rail track ever leaves the composed canvas.
 */
export function gridMargin({ crossingCount }: GridRoutingEdges): number {
	const span = CROSSING_SPACING * Math.max(0, crossingCount - 1);
	return OUTER_RAIL_OFFSET * 2 + span;
}

/**
 * The side a column leaves by: every gutter but the last sits on the left of its column, and the
 * last gutter is the right frame.
 */
export function crossingEndpointSide(
	column: number,
	columnCount: number,
): RegionPortalSide.Left | RegionPortalSide.Right {
	if (column < columnCount - 1) return RegionPortalSide.Left;
	return RegionPortalSide.Right;
}

/** Rail x: OUTER_RAIL_OFFSET + CROSSING_SPACING * track outside the grid frame. */
export function crossingRailX(
	edge: RoutingEdge,
	frameX: number,
	side: RegionPortalSide.Left | RegionPortalSide.Right,
	track: number,
): number {
	const offset = RAIL_ANCHOR_OFFSET + trackOffset(edge, track);
	if (side === RegionPortalSide.Left) return frameX - offset;
	return frameX + offset;
}

/** Bus y: TOP_BUS_Y + CROSSING_SPACING * track below the canvas top. */
export function crossingBusY(edge: RoutingEdge, track: number): number {
	return BUS_ANCHOR_Y + trackOffset(edge, track);
}

/** The declared face edge of one crossing endpoint: one port track per incident crossing relation. */
export function crossingFaceEdge(endpointId: string, incidenceCount: number): RoutingEdge {
	return { ownerId: endpointId, capacity: incidenceCount, spacing: CROSSING_SPACING };
}

/** Port y on a face: the port tracks are centred on the element. */
export function crossingPortY(bounds: Bounds, edge: RoutingEdge, track: number): number {
	const centre = bounds.y + bounds.height / 2;
	const centring = (edgeExtent(edge) + edge.spacing) / 2;
	return centre + trackOffset(edge, track) - centring;
}

/** The declared port positions of an endpoint's own face, in track order. */
export function crossingPortPositions(
	endpointId: string,
	bounds: Bounds,
	incidenceCount: number,
): readonly number[] {
	const edge = crossingFaceEdge(endpointId, incidenceCount);
	return Array.from({ length: incidenceCount }, (_, track) => crossingPortY(bounds, edge, track));
}

export function crossingIncidence(
	crossing: readonly LogicRelation[],
): ReadonlyMap<string, readonly string[]> {
	const byEndpoint = new Map<string, string[]>();
	for (const relation of crossing) {
		for (const id of [relation.from, relation.to]) {
			const incident = byEndpoint.get(id) ?? [];
			incident.push(relation.id);
			byEndpoint.set(id, incident);
		}
	}
	for (const incident of byEndpoint.values()) incident.sort(compareCanonicalStrings);
	return byEndpoint;
}

export function crossingMetricDemands(
	incidence: ReadonlyMap<string, readonly string[]>,
): readonly MinimumEndpointExtentMetricDemand[] {
	return [...incidence]
		.sort(([left], [right]) => compareCanonicalStrings(left, right))
		.map(([endpointId, relations]) => {
			const span = CROSSING_SPACING * (relations.length - 1);
			return {
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId,
				axis: MetricAxis.Height,
				minimum: PORT_INSET * 2 + span,
			};
		});
}

function segmentOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
	if (equal(a.x, b.x) && equal(c.x, d.x) && equal(a.x, c.x)) {
		const high = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
		const low = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
		return high > low + 1e-6;
	}
	if (equal(a.y, b.y) && equal(c.y, d.y) && equal(a.y, c.y)) {
		const high = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
		const low = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
		return high > low + 1e-6;
	}
	return false;
}

function routesOverlap(first: LayoutRelation, second: LayoutRelation): boolean {
	for (let i = 0; i < first.points.length - 1; i += 1) {
		for (let j = 0; j < second.points.length - 1; j += 1) {
			if (
				segmentOverlap(
					defined(first.points[i]),
					defined(first.points[i + 1]),
					defined(second.points[j]),
					defined(second.points[j + 1]),
				)
			)
				return true;
		}
	}
	return false;
}

export interface CrossingOverlap {
	readonly firstId: string;
	readonly secondId: string;
	readonly message: string;
}

export function crossingOverlap(routes: readonly LayoutRelation[]): CrossingOverlap | undefined {
	for (const [index, first] of routes.entries()) {
		for (const second of routes.slice(index + 1)) {
			if (routesOverlap(first, second))
				return {
					firstId: first.id,
					secondId: second.id,
					message: `Cross-cell relations ${first.id} and ${second.id} overlap.`,
				};
		}
	}
	return undefined;
}
