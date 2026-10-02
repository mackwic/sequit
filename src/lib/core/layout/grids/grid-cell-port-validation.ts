import { defined, type LogicRelation } from '../../document/logic-document';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../geometry/region-geometry-diagnostic';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import type { RegionPortalSide } from '../regions/model/region-composition-types';
import { crossingEndpointSide, crossingIncidence } from './grid-cell-crossing';
import {
	acrossFace,
	adjacentCellSide,
	alongFace,
	faceLine,
	faceSpan,
	leavesFace,
} from './grid-cell-crossing-face';
import { crossingPortOnFace, validCrossingPortStack } from './grid-cell-crossing-port-stack';
import { equal, samePoint, within } from './grid-cell-geometry-primitives';
import { type IncidentPieceEnds, incidentPieceEnds } from './grid-cell-incident-route';
import type { GridCellPlacement, GridCellPortal, GridCellSelected } from './grid-cell-types';

interface CrossPortContext {
	readonly fromCell: GridCellPlacement;
	readonly toCell: GridCellPlacement;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

/**
 * The side a crossing end declares by its published portal, when that portal lies on this side of
 * its cell. Otherwise it is the column's gutter side, so the port is still checked and the portal
 * check names the inconsistent portal.
 */
function declaredSide(
	candidate: GridCellSelected,
	relationId: string,
	endpointId: string,
	cell: GridCellPlacement,
): RegionPortalSide {
	const portal = candidate.portals.find(
		(candidatePortal) =>
			candidatePortal.relationId === relationId && candidatePortal.endpointId === endpointId,
	);
	const gutter = crossingEndpointSide(cell.column, candidate.columnWidths.length);
	if (portal === undefined) return gutter;
	if (!equal(acrossFace(portal.point, portal.side), faceLine(cell.bounds, portal.side)))
		return gutter;
	return portal.side;
}

/** A crossing end ports on its column's gutter side or on the side facing its neighbour cell. */
function admissibleSide(
	side: RegionPortalSide,
	cell: GridCellPlacement,
	other: GridCellPlacement,
	columnCount: number,
): boolean {
	return (
		side === crossingEndpointSide(cell.column, columnCount) ||
		side === adjacentCellSide(cell, other)
	);
}

/** The face a crossing endpoint ports on is its own published element; a missing one is named. */
export function validateCrossPorts(
	candidate: GridCellSelected,
	route: LayoutRelation,
	context: CrossPortContext,
): RegionGeometryDiagnostic | undefined {
	const { elements } = candidate.layout;
	const sourceElement = elements.find(({ id }) => id === route.from);
	const targetElement = elements.find(({ id }) => id === route.to);
	if (sourceElement === undefined || targetElement === undefined) {
		let missingId = route.to;
		if (sourceElement === undefined) missingId = route.from;
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridGroupFaceMissing,
			`Cross-cell relation ${route.id} has no published face for endpoint ${missingId}.`,
			{ relationId: route.id, endpointId: missingId },
		);
	}
	const onFace = (point: Point, endpointId: string, bounds: Bounds, cell: GridCellPlacement) => {
		const side = declaredSide(candidate, route.id, endpointId, cell);
		const stack = defined(context.incidence.get(endpointId)).filter(
			(relationId) => declaredSide(candidate, relationId, endpointId, cell) === side,
		);
		return (
			equal(acrossFace(point, side), faceLine(bounds, side)) &&
			crossingPortOnFace(bounds, side, stack.length, alongFace(point, side))
		);
	};
	const sourceOnFace = onFace(
		defined(route.points[0]),
		route.from,
		sourceElement.bounds,
		context.fromCell,
	);
	const targetOnFace = onFace(
		defined(route.points.at(-1)),
		route.to,
		targetElement.bounds,
		context.toCell,
	);
	if (!sourceOnFace || !targetOnFace)
		return regionGeometryDiagnostic(
			RegionGeometryDiagnosticCode.GridCrossingPort,
			`Cross-cell relation ${route.id} has invalid endpoint ports.`,
			{ relationId: route.id },
		);
	return undefined;
}

/**
 * A shared endpoint stacks one port per incident crossing on the declared positions of each face
 * it ports on, moved together by whole tracks at most. The allocation may permute which relation
 * takes which position, never the positions themselves.
 */
export function validateCrossPortStacking(
	candidate: GridCellSelected,
	crossing: readonly LogicRelation[],
): string | undefined {
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	const routes = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	const portals = new Map(
		candidate.portals.map((portal) => [`${portal.relationId}\u0000${portal.endpointId}`, portal]),
	);
	for (const [endpointId, relations] of crossingIncidence(crossing)) {
		if (relations.length < 2) continue;
		const bounds = defined(elements.get(endpointId)).bounds;
		const bySide = new Map<RegionPortalSide, number[]>();
		for (const relationId of relations) {
			const route = defined(routes.get(relationId));
			let port = defined(route.points.at(-1));
			if (route.from === endpointId) port = defined(route.points[0]);
			const side = defined(portals.get(`${relationId}\u0000${endpointId}`)).side;
			const coordinates = bySide.get(side) ?? [];
			coordinates.push(alongFace(port, side));
			bySide.set(side, coordinates);
		}
		const stacked = [...bySide].every(([side, coordinates]) =>
			validCrossingPortStack(
				bounds,
				side,
				coordinates.sort((left, right) => left - right),
			),
		);
		if (!stacked)
			return `Cross-cell relations do not stack their ports on shared endpoint ${endpointId}.`;
	}
	return undefined;
}

function checkPortal(
	portal: GridCellPortal,
	candidate: GridCellSelected,
	other: GridCellPlacement,
): boolean {
	const cell = defined(candidate.cells.find(({ id }) => id === portal.cellId));
	if (portal.regionId !== cell.id) return false;
	if (!admissibleSide(portal.side, cell, other, candidate.columnWidths.length)) return false;
	const local = { x: 0, y: 0, width: cell.bounds.width, height: cell.bounds.height };
	if (!equal(acrossFace(portal.localPoint, portal.side), faceLine(local, portal.side)))
		return false;
	const along = alongFace(portal.localPoint, portal.side);
	if (along < 0 || along > faceSpan(local, portal.side).length) return false;
	return (
		equal(acrossFace(portal.point, portal.side), faceLine(cell.bounds, portal.side)) &&
		samePoint(portal.point, {
			x: cell.bounds.x + portal.localPoint.x,
			y: cell.bounds.y + portal.localPoint.y,
		})
	);
}

/** A cell piece, `points[start..end]`, and the index of its port at one of those ends. */
interface CellPiece {
	readonly start: number;
	readonly end: number;
	readonly port: number;
}

/**
 * The cell piece leaves its port straight out of its portal-side face and stays in its cell; the
 * element checks then prove it avoids the cell's other boxes.
 */
function checkEndpointContact(
	points: readonly Point[],
	portal: GridCellPortal,
	cell: GridCellPlacement,
	{ start, end, port: portIndex }: CellPiece,
): boolean {
	const port = defined(points[portIndex]);
	let nextIndex = end - 1;
	if (portIndex === start) nextIndex = start + 1;
	const next = defined(points[nextIndex]);
	if (!equal(alongFace(port, portal.side), alongFace(next, portal.side))) return false;
	if (!leavesFace(port, next, portal.side)) return false;
	let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
	for (let index = start; index <= end; index += 1) {
		const { x, y } = defined(points[index]);
		left = Math.min(left, x);
		top = Math.min(top, y);
		right = Math.max(right, x);
		bottom = Math.max(bottom, y);
	}
	return within(cell.bounds, { x: left, y: top, width: right - left, height: bottom - top });
}

/** A crossing's two portals, source first, or undefined unless it has exactly two. */
function portalPair(
	portals: readonly GridCellPortal[],
	relationId: string,
): readonly [GridCellPortal, GridCellPortal] | undefined {
	let source: GridCellPortal | undefined;
	let target: GridCellPortal | undefined;
	for (const portal of portals) {
		if (portal.relationId !== relationId) continue;
		if (target !== undefined) return undefined;
		if (source === undefined) source = portal;
		else target = portal;
	}
	if (source === undefined || target === undefined) return undefined;
	return [source, target];
}

function crossPortalEnds(
	candidate: GridCellSelected,
	route: LayoutRelation,
	fromCell: GridCellPlacement,
	toCell: GridCellPlacement,
): IncidentPieceEnds | undefined {
	const pair = portalPair(candidate.portals, route.id);
	if (pair === undefined) return undefined;
	const [sourcePortal, targetPortal] = pair;
	const owners = sourcePortal.cellId === fromCell.id && targetPortal.cellId === toCell.id;
	const endpoints = sourcePortal.endpointId === route.from && targetPortal.endpointId === route.to;
	if (!owners || !endpoints) return undefined;
	if (
		!checkPortal(sourcePortal, candidate, toCell) ||
		!checkPortal(targetPortal, candidate, fromCell)
	)
		return undefined;
	const { points } = route;
	const ends = incidentPieceEnds(points, sourcePortal.point, targetPortal.point);
	if (ends === undefined) return undefined;
	const source = { start: 0, end: ends.sourceEnd, port: 0 };
	if (!checkEndpointContact(points, sourcePortal, fromCell, source)) return undefined;
	const last = points.length - 1;
	const target = { start: ends.targetStart, end: last, port: last };
	if (!checkEndpointContact(points, targetPortal, toCell, target)) return undefined;
	return ends;
}

/** The piece ends of a crossing whose portals and cell pieces are valid, else the failure. */
export function validateCrossPortals(
	candidate: GridCellSelected,
	route: LayoutRelation,
	fromCell: GridCellPlacement,
	toCell: GridCellPlacement,
): IncidentPieceEnds | string {
	return (
		crossPortalEnds(candidate, route, fromCell, toCell) ??
		`Cross-cell relation ${route.id} has invalid portals.`
	);
}
