import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import {
	CROSSING_SPACING,
	crossingRailX,
	gridRoutingEdges,
	reservedRailTrack,
} from './grid-cell-crossing';
import type { GridCellPlacement, GridCellSelected } from './grid-cell-types';
import type { Point } from './layout-types';
import {
	boundaryPortal,
	type RegionIncidentPath,
	type SolvedRecursiveRegion,
	translatedIncidentPath,
} from './nested-region-recursive-geometry';
import {
	directChild,
	type IncidentSides,
	type RecursiveContext,
} from './nested-region-recursive-model-adapter';
import { RegionPortalSide } from './region-composition-types';

interface GridIncidentInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly incidentSides: IncidentSides;
	readonly selected: GridCellSelected;
	readonly children: ReadonlyMap<string, SolvedRecursiveRegion>;
}

function framedPoint(
	portal: RegionIncidentPath['portals'][number],
	cell: GridCellPlacement,
): Point {
	switch (portal.side) {
		case RegionPortalSide.Left:
			return { x: cell.bounds.x, y: portal.point.y };
		case RegionPortalSide.Right:
			return { x: cell.bounds.x + cell.bounds.width, y: portal.point.y };
		case RegionPortalSide.Top:
			return { x: portal.point.x, y: cell.bounds.y };
		case RegionPortalSide.Bottom:
			return { x: portal.point.x, y: cell.bounds.y + cell.bounds.height };
		default:
			throw new Error('Unknown grid child portal side.');
	}
}

/** The grid track can be larger than the solved child frame. */
function extendedToCellFrame(
	path: RegionIncidentPath,
	cell: GridCellPlacement,
	source: boolean,
): RegionIncidentPath {
	let index = 0;
	if (source) index = path.portals.length - 1;
	const portal = defined(path.portals[index]);
	const point = framedPoint(portal, cell);
	if (point.x === portal.point.x && point.y === portal.point.y) return path;
	let pieceIndex = 0;
	if (source) pieceIndex = path.pieces.length - 1;
	const piece = defined(path.pieces[pieceIndex]);
	const pieces = [...path.pieces];
	let points = [point, ...piece.points];
	if (source) points = [...piece.points, point];
	pieces[pieceIndex] = {
		...piece,
		points,
	};
	const portals = [...path.portals];
	portals[index] = {
		...portal,
		point,
		localPoint: { x: point.x - cell.bounds.x, y: point.y - cell.bounds.y },
	};
	return { ...path, pieces, portals };
}

interface ContinuationInput {
	readonly grid: GridIncidentInput;
	readonly cell: GridCellPlacement;
	readonly childPortal: RegionIncidentPath['portals'][number];
	readonly side: RegionPortalSide;
	readonly relationId: string;
	readonly endpointId: string;
}

function outerRailX(grid: GridIncidentInput, cell: GridCellPlacement): number {
	const crossingCount = grid.selected.portals.length / 2;
	const edges = gridRoutingEdges(grid.regionId, crossingCount);
	const track = reservedRailTrack(edges);
	if (cell.column === 0) {
		const left = defined(grid.selected.cells.find(({ column }) => column === 0)).bounds.x;
		return crossingRailX(edges.leftRail, left, RegionPortalSide.Left, track);
	}
	const right =
		defined(grid.selected.cells.find(({ column }) => column === 1)).bounds.x +
		defined(grid.selected.columnWidths[1]);
	return crossingRailX(edges.leftRail, right, RegionPortalSide.Right, track);
}

function childPortalApproach(
	cell: GridCellPlacement,
	childPortal: RegionIncidentPath['portals'][number],
): { readonly points: Point[]; readonly y: number } {
	const points: Point[] = [childPortal.point];
	let y = childPortal.point.y;
	const fromLeftToOuterRail = childPortal.side === RegionPortalSide.Left && cell.column === 1;
	const fromRightToOuterRail = childPortal.side === RegionPortalSide.Right && cell.column === 0;
	const innerLateral = fromLeftToOuterRail || fromRightToOuterRail;
	if (innerLateral) {
		let offset = -CROSSING_SPACING;
		if (childPortal.side === RegionPortalSide.Right) offset = CROSSING_SPACING;
		const gapX = childPortal.point.x + offset;
		points.push({ x: gapX, y });
		y = cell.bounds.y - CROSSING_SPACING;
		if (cell.row === 1) y = cell.bounds.y + cell.bounds.height + CROSSING_SPACING;
		points.push({ x: gapX, y });
		return { points, y };
	}
	if (childPortal.side === RegionPortalSide.Top) y -= CROSSING_SPACING;
	if (childPortal.side === RegionPortalSide.Bottom) y += CROSSING_SPACING;
	if (y !== childPortal.point.y) points.push({ x: childPortal.point.x, y });
	return { points, y };
}

function outerPortalY(
	grid: GridIncidentInput,
	cell: GridCellPlacement,
	side: RegionPortalSide,
	approachY: number,
): number {
	const exitsLeftFromRightCell = side === RegionPortalSide.Left && cell.column === 1;
	const exitsRightFromLeftCell = side === RegionPortalSide.Right && cell.column === 0;
	const oppositeColumn = exitsLeftFromRightCell || exitsRightFromLeftCell;
	if (oppositeColumn) return defined(grid.selected.cells[0]).bounds.y / 2;
	return approachY;
}

function continuation({
	grid,
	cell,
	childPortal,
	side,
	relationId,
	endpointId,
}: ContinuationInput): {
	readonly points: readonly Point[];
	readonly portal: RegionIncidentPath['portals'][number];
} {
	const railX = outerRailX(grid, cell);
	const { points, y: approachY } = childPortalApproach(cell, childPortal);
	points.push({ x: railX, y: approachY });
	const portalY = outerPortalY(grid, cell, side, approachY);
	const portal = boundaryPortal({
		relationId,
		endpointId,
		regionId: grid.regionId,
		side,
		x: railX,
		y: portalY,
		canvasWidth: grid.selected.layout.width,
		canvasHeight: grid.selected.layout.height,
	});
	if (side === RegionPortalSide.Top || side === RegionPortalSide.Bottom)
		points.push({ x: railX, y: portal.point.y });
	else if (portalY === approachY) points.push(portal.point);
	else points.push({ x: railX, y: portalY }, portal.point);
	return { points, portal };
}

/** Continue each selected child incident through free grid tracks to the grid frame. */
export function gridCellInheritedIncidentPaths(
	input: GridIncidentInput,
): ReadonlyMap<string, RegionIncidentPath> {
	const paths = new Map<string, RegionIncidentPath>();
	const ordered = [...input.incidentSides].sort(([a], [b]) => compareCanonicalStrings(a, b));
	for (const [relationId, sides] of ordered) {
		const owned = defined(input.context.ownershipByRelationId.get(relationId));
		const source = owned.sourcePathToOwner.includes(input.regionId);
		let endpointId = owned.relation.to;
		if (source) endpointId = owned.relation.from;
		const childId = directChild(input.context, input.regionId, endpointId);
		const cell = defined(input.selected.cells.find(({ id }) => id === childId));
		const child = defined(input.children.get(childId));
		const path = extendedToCellFrame(
			translatedIncidentPath(defined(child.incidentPaths.get(relationId)), cell.translation),
			cell,
			source,
		);
		let childPortal = path.portals[0];
		if (source) childPortal = path.portals.at(-1);
		childPortal = defined(childPortal);
		const side = defined(sides[0]);
		const { points, portal } = continuation({
			grid: input,
			cell,
			childPortal,
			side,
			relationId,
			endpointId,
		});
		let orientedPoints = [...points].reverse();
		let pieces = [{ relationId, regionId: input.regionId, points: orientedPoints }, ...path.pieces];
		let portals = [portal, ...path.portals];
		if (source) {
			orientedPoints = [...points];
			pieces = [...path.pieces, { relationId, regionId: input.regionId, points: orientedPoints }];
			portals = [...path.portals, portal];
		}
		paths.set(relationId, {
			relationId,
			endpointId,
			pieces,
			portals,
		});
	}
	return paths;
}
