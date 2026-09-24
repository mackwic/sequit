import { defined } from '../document/logic-document';
import { crossingPortY } from './grid-cell-crossing';
import { equal, samePoint } from './grid-cell-geometry-primitives';
import type { GridCellPlacement, GridCellPortal, GridCellSelected } from './grid-cell-types';
import type { Bounds, LayoutRelation } from './layout-types';
import { RegionPortalSide } from './region-composition-types';

interface CrossPortContext {
	readonly fromCell: GridCellPlacement;
	readonly toCell: GridCellPlacement;
	readonly incidence: ReadonlyMap<string, readonly string[]>;
}

function outerPortX(bounds: Bounds, side: RegionPortalSide.Left | RegionPortalSide.Right): number {
	if (side === RegionPortalSide.Left) return bounds.x;
	return bounds.x + bounds.width;
}

function sideOf(cell: GridCellPlacement): RegionPortalSide.Left | RegionPortalSide.Right {
	if (cell.column === 0) return RegionPortalSide.Left;
	return RegionPortalSide.Right;
}

export function validateCrossPorts(
	candidate: GridCellSelected,
	route: LayoutRelation,
	context: CrossPortContext,
): string | undefined {
	const elements = new Map(candidate.layout.elements.map((element) => [element.id, element]));
	const source = defined(elements.get(route.from)).bounds;
	const target = defined(elements.get(route.to)).bounds;
	const first = defined(route.points[0]);
	const last = defined(route.points.at(-1));
	const sourcePort = {
		x: outerPortX(source, sideOf(context.fromCell)),
		y: crossingPortY(source, route.from, route.id, context.incidence),
	};
	const targetPort = {
		x: outerPortX(target, sideOf(context.toCell)),
		y: crossingPortY(target, route.to, route.id, context.incidence),
	};
	if (!samePoint(first, sourcePort) || !samePoint(last, targetPort))
		return `Cross-cell relation ${route.id} has invalid endpoint ports.`;
	return undefined;
}

function checkPortal(portal: GridCellPortal, candidate: GridCellSelected): boolean {
	const cell = candidate.cells.find(({ id }) => id === portal.cellId);
	const knownCell = defined(cell);
	if (portal.regionId !== knownCell.id) return false;
	if (portal.side !== sideOf(knownCell)) return false;
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
