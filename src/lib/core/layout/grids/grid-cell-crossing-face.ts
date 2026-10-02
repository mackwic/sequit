import type { RoutingEdge } from '../geometry/routing-edge';
import type { Bounds, Point } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import { edgeExtent, trackOffset } from '../resources/routing-resource-allocation';
import { crossingFaceEdge } from './grid-cell-crossing';

/** A grid cell position: its row and column. */
interface GridPosition {
	readonly row: number;
	readonly column: number;
}

/** A left or right face stacks its ports along y; a top or bottom face along x. */
function lateralSide(side: RegionPortalSide): boolean {
	return side === RegionPortalSide.Left || side === RegionPortalSide.Right;
}

/**
 * The face of `cell` that looks at `other` across a single gap: the facing side of a neighbour in
 * the same row or in the same column, else undefined.
 */
export function adjacentCellSide(
	cell: GridPosition,
	other: GridPosition,
): RegionPortalSide | undefined {
	const columns = other.column - cell.column;
	const rows = other.row - cell.row;
	if (rows === 0) {
		if (columns === 1) return RegionPortalSide.Right;
		if (columns === -1) return RegionPortalSide.Left;
		return undefined;
	}
	if (columns !== 0) return undefined;
	if (rows === 1) return RegionPortalSide.Bottom;
	if (rows === -1) return RegionPortalSide.Top;
	return undefined;
}

/** The fixed coordinate of a face: x of a left or right face, y of a top or bottom face. */
export function faceLine(bounds: Bounds, side: RegionPortalSide): number {
	if (side === RegionPortalSide.Left) return bounds.x;
	if (side === RegionPortalSide.Right) return bounds.x + bounds.width;
	if (side === RegionPortalSide.Top) return bounds.y;
	return bounds.y + bounds.height;
}

/** The start and length of a face along its port axis. */
export function faceSpan(
	bounds: Bounds,
	side: RegionPortalSide,
): { readonly start: number; readonly length: number } {
	if (lateralSide(side)) return { start: bounds.y, length: bounds.height };
	return { start: bounds.x, length: bounds.width };
}

/** The point of a face at `coordinate` along its port axis. */
export function facePoint(bounds: Bounds, side: RegionPortalSide, coordinate: number): Point {
	const line = faceLine(bounds, side);
	if (lateralSide(side)) return { x: line, y: coordinate };
	return { x: coordinate, y: line };
}

/** The coordinate of a point along the port axis of a face on `side`: y or x. */
export function alongFace(point: Point, side: RegionPortalSide): number {
	if (lateralSide(side)) return point.y;
	return point.x;
}

/** The coordinate of a point across a face on `side`: x of a left or right face, else y. */
export function acrossFace(point: Point, side: RegionPortalSide): number {
	if (lateralSide(side)) return point.x;
	return point.y;
}

/** True when `next` lies strictly outside a face on `side`, seen from `from`. */
export function leavesFace(from: Point, next: Point, side: RegionPortalSide): boolean {
	const step = acrossFace(next, side) - acrossFace(from, side);
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Top) return step < 0;
	return step > 0;
}

/** Port coordinate on a face, along its port axis: the port tracks are centred on the element. */
export function crossingPortCoordinate(
	bounds: Bounds,
	side: RegionPortalSide,
	edge: RoutingEdge,
	track: number,
): number {
	const { start, length } = faceSpan(bounds, side);
	const centre = start + length / 2;
	const centring = (edgeExtent(edge) + edge.spacing) / 2;
	return centre + trackOffset(edge, track) - centring;
}

/** The declared port positions of an endpoint's own face, in track order. */
export function crossingPortPositions(
	bounds: Bounds,
	side: RegionPortalSide,
	incidenceCount: number,
): readonly number[] {
	const edge = crossingFaceEdge('', incidenceCount);
	return Array.from({ length: incidenceCount }, (_, track) =>
		crossingPortCoordinate(bounds, side, edge, track),
	);
}
