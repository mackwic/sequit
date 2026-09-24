import { defined } from '../document/logic-document';
import { CROSSING_SPACING } from './grid-cell-crossing';
import type { GridCellPlacement, GridCellSelected } from './grid-cell-types';
import {
	boundaryPortal,
	type RegionIncidentPath,
	type SolvedRecursiveRegion,
	translatedIncidentPath,
} from './nested-region-recursive-geometry';
import { NestedPortalSide } from './nested-region-types';

export interface ExternalGridIncident {
	readonly relationId: string;
	readonly endpointId: string;
	readonly cellId: string;
	readonly source: boolean;
	readonly side: NestedPortalSide;
}

function extendedToCellFrame(
	path: RegionIncidentPath,
	cell: GridCellPlacement,
	source: boolean,
): RegionIncidentPath {
	let portal = path.portals[0];
	let piece = path.pieces[0];
	if (source) {
		portal = path.portals.at(-1);
		piece = path.pieces.at(-1);
	}
	portal = defined(portal);
	piece = defined(piece);
	let boundaryY = cell.bounds.y;
	let localY = 0;
	if (portal.side === NestedPortalSide.Bottom) {
		boundaryY += cell.bounds.height;
		localY = cell.bounds.height;
	}
	if (portal.point.y === boundaryY) return path;
	const point = { x: portal.point.x, y: boundaryY };
	const movedPortal = {
		...portal,
		point,
		localPoint: { x: point.x - cell.bounds.x, y: localY },
	};
	const pieces = [...path.pieces];
	const portals = [...path.portals];
	if (source) {
		pieces[pieces.length - 1] = { ...piece, points: [...piece.points, point] };
		portals[portals.length - 1] = movedPortal;
	} else {
		pieces[0] = { ...piece, points: [point, ...piece.points] };
		portals[0] = movedPortal;
	}
	return { ...path, pieces, portals };
}

/** The allocated track frame may be taller than its child's local layout frame. */
export function outerGridIncidentPath(
	incident: ExternalGridIncident,
	regionId: string,
	selected: GridCellSelected,
	children: ReadonlyMap<string, SolvedRecursiveRegion>,
): RegionIncidentPath {
	const cell = defined(selected.cells.find(({ id }) => id === incident.cellId));
	const solved = defined(children.get(incident.cellId));
	const child = extendedToCellFrame(
		translatedIncidentPath(
			defined(solved.incidentPaths.get(incident.relationId)),
			cell.translation,
		),
		cell,
		incident.source,
	);
	let childPortal = child.portals[0];
	if (incident.source) childPortal = child.portals.at(-1);
	childPortal = defined(childPortal);
	// Above the grid, use a rail outside the inter-cell rails; below it, use the column gap.
	let corridorX = CROSSING_SPACING;
	if (cell.column === 1) corridorX = selected.layout.width - CROSSING_SPACING;
	if (incident.side === NestedPortalSide.Bottom) {
		const left = defined(
			selected.cells.find(({ row, column }) => row === cell.row && column === 0),
		);
		const right = defined(
			selected.cells.find(({ row, column }) => row === cell.row && column === 1),
		);
		const gapStart = left.bounds.x + left.bounds.width;
		corridorX = (gapStart + right.bounds.x) / 2;
	}
	const portal = boundaryPortal({
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		regionId,
		side: incident.side,
		x: corridorX,
		canvasHeight: selected.layout.height,
	});
	const bend = { x: corridorX, y: childPortal.point.y };
	let points = [portal.point, bend, childPortal.point];
	if (incident.source) points = [childPortal.point, bend, portal.point];
	const piece = { relationId: incident.relationId, regionId, points };
	if (incident.source)
		return {
			relationId: incident.relationId,
			endpointId: incident.endpointId,
			pieces: [...child.pieces, piece],
			portals: [...child.portals, portal],
		};
	return {
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		pieces: [piece, ...child.pieces],
		portals: [portal, ...child.portals],
	};
}
