import { defined, type LogicRelation } from '../document/logic-document';
import {
	crossingEndpointSide,
	crossingIncidence,
	crossingPortPositions,
} from './grid-cell-crossing';
import { equal, samePoint } from './grid-cell-geometry-primitives';
import type { GridCellPlacement, GridCellPortal, GridCellSelected } from './grid-cell-types';
import type { Bounds, LayoutRelation, Point } from './layout-types';
import { RegionPortalSide } from './region-composition-types';
import {
	type RegionGeometryDiagnostic,
	regionGeometryDiagnostic,
	RegionGeometryDiagnosticCode,
} from './region-geometry-diagnostic';

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
	const onFace = (point: Point, x: number, endpointId: string, bounds: Bounds): boolean => {
		const positions = crossingPortPositions(
			endpointId,
			bounds,
			defined(context.incidence.get(endpointId)).length,
		);
		return equal(point.x, x) && positions.some((position) => equal(point.y, position));
	};
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
 * A shared endpoint stacks one port per incident crossing on the declared face positions. The
 * allocation may permute which relation takes which position, never the positions themselves.
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
		const positions = crossingPortPositions(candidate.rootId, bounds, relations.length);
		const observed = relations
			.map((relationId) => {
				const route = defined(routes.get(relationId));
				if (route.from === endpointId) return defined(route.points[0]).y;
				return defined(route.points.at(-1)).y;
			})
			.sort((left, right) => left - right);
		if (!observed.every((y, track) => equal(y, defined(positions[track]))))
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

function checkEndpointContact(
	route: LayoutRelation,
	portal: GridCellPortal,
	isSource: boolean,
): boolean {
	let port = route.points[0];
	let contact = route.points[1];
	if (!isSource) {
		port = route.points.at(-1);
		contact = route.points.at(-2);
	}
	if (port === undefined || contact === undefined) return false;
	return samePoint(contact, portal.point) && equal(port.y, contact.y);
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
	if (!checkEndpointContact(route, sourcePortal, true))
		return `Cross-cell relation ${route.id} has invalid portals.`;
	if (!checkEndpointContact(route, targetPortal, false))
		return `Cross-cell relation ${route.id} has invalid portals.`;
	return undefined;
}
