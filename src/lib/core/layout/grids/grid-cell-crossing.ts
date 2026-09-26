import { compareCanonicalStrings } from '../../canonical-string';
import { defined, type LogicRelation } from '../../document/logic-document';
import {
	MetricAxis,
	MetricDemandKind,
	type MinimumEndpointExtentMetricDemand,
} from '../contract/metric-demand';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import {
	edgeExtent,
	type RoutingEdge,
	trackOffset,
} from '../resources/routing-resource-allocation';
import { equal } from './grid-cell-geometry-primitives';

const PORT_INSET = 16;
/** Clearance between two adjacent crossing tracks. */
export const CROSSING_SPACING = 24;
/** Distance from the grid frame to the first rail track. */
const OUTER_RAIL_OFFSET = 48;
export const GRID_GUTTER_MIN_MARGIN = OUTER_RAIL_OFFSET * 2;
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
	/** Total crossings reserved on the global top bus. */
	readonly crossingCount: number;
}

/** Each gutter reserves its own crossings plus one exterior track for inherited incidents or
 * an additional crossing. The bus still reserves every crossing, across all columns. */
export function gridRoutingEdges(
	regionId: string,
	gutterIds: readonly (readonly string[])[],
	crossingCount: number,
): GridRoutingEdges {
	return {
		gutters: gutterIds.map((ids) => ({
			ownerId: regionId,
			capacity: ids.length + 1,
			spacing: CROSSING_SPACING,
		})),
		topBus: { ownerId: regionId, capacity: crossingCount, spacing: CROSSING_SPACING },
		crossingCount,
	};
}

/** The outermost gutter track: reserved for an inherited incident or an added crossing track. */
export function reservedRailTrack(edge: RoutingEdge): number {
	return edge.capacity - 1;
}

/** The top margin reserves the global bus for every crossing, even when no single column carries
 * them all. Side margins are instead paid by the corresponding gutter; the bottom stays at its
 * 96px minimum because there is no bottom bus. */
export function gridMargin({ crossingCount }: GridRoutingEdges): number {
	const span = CROSSING_SPACING * Math.max(0, crossingCount - 1);
	return GRID_GUTTER_MIN_MARGIN + span;
}

/** Clearance around the tracks of one column gutter, with a 96px minimum even when empty. */
export function gridGutterMargin(edge: RoutingEdge): number {
	return GRID_GUTTER_MIN_MARGIN + CROSSING_SPACING * Math.max(0, edge.capacity - 2);
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
