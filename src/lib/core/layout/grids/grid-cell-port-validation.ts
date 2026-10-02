import { defined, type LogicRelation } from '../../document/logic-document';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from '../geometry/region-geometry-diagnostic';
import type { Bounds, LayoutRelation, Point } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import { crossingEndpointSide, crossingIncidence } from './grid-cell-crossing';
import { crossingPortOnFace, validCrossingPortStack } from './grid-cell-crossing-port-stack';
import { equal, samePoint, within } from './grid-cell-geometry-primitives';
import { type IncidentPieceEnds, incidentPieceEnds } from './grid-cell-incident-route';
import type { GridCellPlacement, GridCellPortal, GridCellSelected } from './grid-cell-types';

interface CrossPortContext {
	readonly fromCell: GridCellPlacement;
	readonly toCell: GridCellPlacement;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function outerPortX(bounds: Bounds, side: RegionPortalSide.Left | RegionPortalSide.Right): number {
	if (side === RegionPortalSide.Left) return bounds.x;
	return bounds.x + bounds.width;
}

function sideOf(
	cell: GridCellPlacement,
	columnCount: number,
): RegionPortalSide.Left | RegionPortalSide.Right {
	return crossingEndpointSide(cell.column, columnCount);
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
	const source = sourceElement.bounds;
	const target = targetElement.bounds;
	const first = defined(route.points[0]);
	const last = defined(route.points.at(-1));
	const onFace = (point: Point, x: number, endpointId: string, bounds: Bounds): boolean =>
		equal(point.x, x) &&
		crossingPortOnFace(bounds, defined(context.incidence.get(endpointId)).length, point.y);
	const columnCount = candidate.columnWidths.length;
	const sourceOnFace = onFace(
		first,
		outerPortX(source, sideOf(context.fromCell, columnCount)),
		route.from,
		source,
	);
	const targetOnFace = onFace(
		last,
		outerPortX(target, sideOf(context.toCell, columnCount)),
		route.to,
		target,
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
 * A shared endpoint stacks one port per incident crossing on the declared face positions, moved
 * together by whole tracks at most. The allocation may permute which relation takes which
 * position, never the positions themselves.
 */
export function validateCrossPortStacking(
	candidate: GridCellSelected,
	crossing: readonly LogicRelation[],
): string | undefined {
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	const routes = new Map(candidate.layout.relations.map((route) => [route.id, route]));
	for (const [endpointId, relations] of crossingIncidence(crossing)) {
		if (relations.length < 2) continue;
		const bounds = defined(elements.get(endpointId)).bounds;
		const observed = relations
			.map((relationId) => {
				const route = defined(routes.get(relationId));
				if (route.from === endpointId) return defined(route.points[0]).y;
				return defined(route.points.at(-1)).y;
			})
			.sort((left, right) => left - right);
		if (!validCrossingPortStack(bounds, observed))
			return `Cross-cell relations do not stack their ports on shared endpoint ${endpointId}.`;
	}
	return undefined;
}

function checkPortal(portal: GridCellPortal, candidate: GridCellSelected): boolean {
	const cell = candidate.cells.find(({ id }) => id === portal.cellId);
	const knownCell = defined(cell);
	if (portal.regionId !== knownCell.id) return false;
	if (portal.side !== sideOf(knownCell, candidate.columnWidths.length)) return false;
	let expectedLocalX = 0;
	if (portal.side === RegionPortalSide.Right) expectedLocalX = knownCell.bounds.width;
	if (!equal(portal.localPoint.x, expectedLocalX)) return false;
	if (portal.localPoint.y < 0 || portal.localPoint.y > knownCell.bounds.height) return false;
	return (
		equal(portal.point.x, outerPortX(knownCell.bounds, portal.side)) &&
		samePoint(portal.point, {
			x: knownCell.bounds.x + portal.localPoint.x,
			y: knownCell.bounds.y + portal.localPoint.y,
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
 * The cell piece leaves its port horizontally through its portal-side face and stays in its cell;
 * the element checks then prove it avoids the cell's other boxes.
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
	if (!equal(port.y, next.y)) return false;
	let outward = next.x < port.x;
	if (portal.side === RegionPortalSide.Right) outward = next.x > port.x;
	if (!outward) return false;
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
	if (!checkPortal(sourcePortal, candidate) || !checkPortal(targetPortal, candidate))
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
