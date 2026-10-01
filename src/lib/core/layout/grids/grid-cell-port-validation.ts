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
import { incidentPieceEnds } from './grid-cell-incident-route';
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
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	const sourceElement = elements.get(route.from);
	const targetElement = elements.get(route.to);
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

/**
 * The cell piece leaves the port horizontally through its portal-side face and reaches the portal
 * without leaving its cell; the element checks then prove it avoids the cell's other boxes.
 */
function checkEndpointContact(
	route: LayoutRelation,
	portal: GridCellPortal,
	cell: GridCellPlacement,
	isSource: boolean,
): boolean {
	let points = route.points;
	if (!isSource) points = [...route.points].reverse();
	const end = points.findIndex((point, index) => index > 0 && samePoint(point, portal.point));
	const [port, next] = points;
	if (port === undefined || next === undefined) return false;
	if (end < 1 || !equal(port.y, next.y)) return false;
	let outward = next.x < port.x;
	if (portal.side === RegionPortalSide.Right) outward = next.x > port.x;
	const piece = points.slice(0, end + 1);
	return outward && piece.every((point) => within(cell.bounds, { ...point, width: 0, height: 0 }));
}

export function validateCrossPortals(
	candidate: GridCellSelected,
	route: LayoutRelation,
	fromCell: GridCellPlacement,
	toCell: GridCellPlacement,
): string | undefined {
	const portals = candidate.portals.filter(({ relationId }) => relationId === route.id);
	if (portals.length !== 2) return `Cross-cell relation ${route.id} has invalid portals.`;
	const sourcePortal = defined(portals[0]);
	const targetPortal = defined(portals[1]);
	const owners = sourcePortal.cellId === fromCell.id && targetPortal.cellId === toCell.id;
	const endpoints = sourcePortal.endpointId === route.from && targetPortal.endpointId === route.to;
	if (!owners || !endpoints) return `Cross-cell relation ${route.id} has invalid portals.`;
	if (!checkPortal(sourcePortal, candidate) || !checkPortal(targetPortal, candidate))
		return `Cross-cell relation ${route.id} has invalid portals.`;
	if (!checkEndpointContact(route, sourcePortal, fromCell, true))
		return `Cross-cell relation ${route.id} has invalid portals.`;
	if (!checkEndpointContact(route, targetPortal, toCell, false))
		return `Cross-cell relation ${route.id} has invalid portals.`;
	if (incidentPieceEnds(route.points, sourcePortal.point, targetPortal.point) === undefined)
		return `Cross-cell relation ${route.id} has invalid portals.`;
	return undefined;
}
