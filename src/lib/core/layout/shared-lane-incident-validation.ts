import { defined } from '../document/logic-document';
import { disallowedRouteContacts } from './bridge-contact';
import { type LayoutBridge, validatedBridges } from './bridge-oracle';
import { PORT_INSET, PORT_SPACING } from './layout-settings';
import type { Bounds, Point } from './layout-types';
import { orthogonal, samePoint } from './nested-region-geometry-primitives';
import { RegionPortalSide } from './region-composition-types';
import { incidentEndpointRoute } from './region-incident-contact';
import {
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	type RegionSolvedIncident,
} from './region-incident-contract';
import { hitsBox } from './shared-lane-geometry-primitives';
import { facePortEdge, incidentFaceKey, type SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneGeometry } from './shared-lane-types';

const INCIDENT_CLEARANCE = 12;

export interface SharedLaneIncidentFailure {
	readonly code: RegionIncidentRejectionCode;
	readonly reason: string;
}

function failure(code: RegionIncidentRejectionCode, reason: string): SharedLaneIncidentFailure {
	return { code, reason };
}

function anchorOnSide(bounds: Bounds, side: RegionPortalSide, offset: number): Point {
	switch (side) {
		case RegionPortalSide.Left:
			return { x: bounds.x, y: bounds.y + bounds.height / 2 + offset };
		case RegionPortalSide.Right:
			return {
				x: bounds.x + bounds.width,
				y: bounds.y + bounds.height / 2 + offset,
			};
		case RegionPortalSide.Top:
			return { x: bounds.x + bounds.width / 2 + offset, y: bounds.y };
		case RegionPortalSide.Bottom:
			return {
				x: bounds.x + bounds.width / 2 + offset,
				y: bounds.y + bounds.height,
			};
		default:
			throw new Error(`Unknown incident side ${String(side)}.`);
	}
}

function portalOnSide(anchor: Point, geometry: SharedLaneGeometry, side: RegionPortalSide): Point {
	switch (side) {
		case RegionPortalSide.Left:
			return { x: 0, y: anchor.y };
		case RegionPortalSide.Right:
			return { x: geometry.width, y: anchor.y };
		case RegionPortalSide.Top:
			return { x: anchor.x, y: 0 };
		case RegionPortalSide.Bottom:
			return { x: anchor.x, y: geometry.height };
		default:
			throw new Error(`Unknown incident side ${String(side)}.`);
	}
}

/** Materialize one physical face choice, independent of the parent arrangement. */
export function directSharedLaneIncidentPath(
	geometry: SharedLaneGeometry,
	ports: SharedLanePorts,
	contract: RegionIncidentContract,
	side: RegionPortalSide,
): RegionSolvedIncident | SharedLaneIncidentFailure {
	const source = geometry.elements.find(({ id }) => id === contract.endpointId);
	if (source === undefined)
		return failure(
			RegionIncidentRejectionCode.InvalidAttachment,
			`Incident ${contract.relation.id} has no local endpoint ${contract.endpointId}.`,
		);
	const offset = ports.incidentOffsetByFace.get(incidentFaceKey(contract, side)) ?? 0;
	const anchor = anchorOnSide(source.bounds, side, offset);
	const portal = portalOnSide(anchor, geometry, side);
	return {
		relationId: contract.relation.id,
		endpointId: contract.endpointId,
		role: contract.role,
		side,
		anchor,
		portal,
		points: [anchor, portal],
	};
}

function attachedToFace(anchor: Point, bounds: Bounds, side: RegionPortalSide): boolean {
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Right) {
		let face = bounds.x;
		if (side === RegionPortalSide.Right) face += bounds.width;
		const onFace = anchor.x === face;
		const aboveInset = anchor.y >= bounds.y + PORT_INSET;
		const belowInset = anchor.y <= bounds.y + bounds.height - PORT_INSET;
		return onFace && aboveInset && belowInset;
	}
	let face = bounds.y;
	if (side === RegionPortalSide.Bottom) face += bounds.height;
	const onFace = anchor.y === face;
	const afterInset = anchor.x >= bounds.x + PORT_INSET;
	const beforeInset = anchor.x <= bounds.x + bounds.width - PORT_INSET;
	return onFace && afterInset && beforeInset;
}

function outward(start: Point, next: Point, side: RegionPortalSide): boolean {
	switch (side) {
		case RegionPortalSide.Left:
			return next.y === start.y && next.x < start.x;
		case RegionPortalSide.Right:
			return next.y === start.y && next.x > start.x;
		case RegionPortalSide.Top:
			return next.x === start.x && next.y < start.y;
		case RegionPortalSide.Bottom:
			return next.x === start.x && next.y > start.y;
		default:
			return false;
	}
}

function boundary(portal: Point, geometry: SharedLaneGeometry, side: RegionPortalSide): boolean {
	const insideX = portal.x >= 0 && portal.x <= geometry.width;
	const insideY = portal.y >= 0 && portal.y <= geometry.height;
	if (!insideX || !insideY) return false;
	switch (side) {
		case RegionPortalSide.Left:
			return portal.x === 0;
		case RegionPortalSide.Right:
			return portal.x === geometry.width;
		case RegionPortalSide.Top:
			return portal.y === 0;
		case RegionPortalSide.Bottom:
			return portal.y === geometry.height;
		default:
			return false;
	}
}

function routePortOnFace(
	points: readonly Point[],
	endpointId: string,
	from: string,
	to: string,
): Point | undefined {
	if (from === endpointId) return points[0];
	if (to === endpointId) return points.at(-1);
	return undefined;
}

/** Two ports of one face land on the same track when they are closer than the face edge spacing. */
function sameFacePort(port: Point, anchor: Point, side: RegionPortalSide): boolean {
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Right) {
		const gap = Math.abs(port.y - anchor.y);
		return port.x === anchor.x && gap < PORT_SPACING;
	}
	const gap = Math.abs(port.x - anchor.x);
	return port.y === anchor.y && gap < PORT_SPACING;
}

function matchesContract(contract: RegionIncidentContract, path: RegionSolvedIncident): boolean {
	const identity = path.relationId === contract.relation.id;
	const endpoint = path.endpointId === contract.endpointId;
	const role = path.role === contract.role;
	const side = contract.allowedSides.includes(path.side);
	return identity && endpoint && role && side;
}

function validPathShape(
	geometry: SharedLaneGeometry,
	bounds: Bounds,
	path: RegionSolvedIncident,
): boolean {
	const first = path.points[0];
	const next = path.points[1];
	const last = path.points.at(-1);
	if (first === undefined || next === undefined) return false;
	if (!samePoint(first, path.anchor) || !samePoint(defined(last), path.portal)) return false;
	if (!attachedToFace(path.anchor, bounds, path.side)) return false;
	if (!outward(first, next, path.side)) return false;
	if (!boundary(path.portal, geometry, path.side)) return false;
	return orthogonal(path.points);
}

function elementContact(
	geometry: SharedLaneGeometry,
	endpointId: string,
	path: RegionSolvedIncident,
): SharedLaneIncidentFailure | undefined {
	for (let index = 1; index < path.points.length; index += 1) {
		const start = defined(path.points[index - 1]);
		const end = defined(path.points[index]);
		for (const other of geometry.elements) {
			if (other.id === endpointId && index === 1) continue;
			if (hitsBox(start, end, other.bounds, INCIDENT_CLEARANCE))
				return failure(
					RegionIncidentRejectionCode.RouteObstructed,
					`Incident ${path.relationId} crosses node ${other.id} in its lane leaf.`,
				);
		}
	}
	return undefined;
}

function localRouteContact(
	geometry: SharedLaneGeometry,
	bounds: Bounds,
	path: RegionSolvedIncident,
	bridges: readonly LayoutBridge[],
): SharedLaneIncidentFailure | undefined {
	const current = incidentEndpointRoute(path);
	const edge = facePortEdge(path.endpointId, path.side, bounds);
	for (const route of geometry.relations) {
		const port = routePortOnFace(route.points, path.endpointId, route.from, route.to);
		if (port !== undefined && sameFacePort(port, path.anchor, path.side))
			return failure(
				RegionIncidentRejectionCode.PortUnavailable,
				`Incident ${path.relationId} cannot use edge ${edge.ownerId}: an occupied slot is beside the demanded port within PORT_SPACING (held by ${route.id}).`,
			);
		if (disallowedRouteContacts(current, route, bridges).length > 0)
			return failure(
				RegionIncidentRejectionCode.RouteObstructed,
				`Incident ${path.relationId} touches local relation ${route.id} in its lane leaf.`,
			);
	}
	return undefined;
}

function earlierIncidentContact(
	path: RegionSolvedIncident,
	earlier: readonly RegionSolvedIncident[],
	bridges: readonly LayoutBridge[],
): SharedLaneIncidentFailure | undefined {
	for (const previous of earlier) {
		if (
			disallowedRouteContacts(incidentEndpointRoute(path), incidentEndpointRoute(previous), bridges)
				.length > 0
		)
			return failure(
				RegionIncidentRejectionCode.RouteObstructed,
				`Incident ${path.relationId} touches incident ${previous.relationId} in its lane leaf.`,
			);
	}
	return undefined;
}

/** Independent geometric check of a lane leaf's claimed incident passage. */
export function validateSharedLaneIncidentPath(
	geometry: SharedLaneGeometry,
	contract: RegionIncidentContract,
	path: RegionSolvedIncident,
	earlier: readonly RegionSolvedIncident[] = [],
): SharedLaneIncidentFailure | undefined {
	const relationId = contract.relation.id;
	const source = geometry.elements.find(({ id }) => id === contract.endpointId);
	if (source === undefined)
		return failure(
			RegionIncidentRejectionCode.InvalidAttachment,
			`Incident ${relationId} has no local endpoint ${contract.endpointId}.`,
		);
	if (!matchesContract(contract, path))
		return failure(
			RegionIncidentRejectionCode.InvalidAttachment,
			`Incident ${relationId} does not match its requested endpoint, role, or side.`,
		);
	if (!validPathShape(geometry, source.bounds, path))
		return failure(
			RegionIncidentRejectionCode.PortUnavailable,
			`Incident ${relationId} has no ${path.side}-facing port capacity.`,
		);
	const bridges = validatedBridges([
		...geometry.relations,
		...earlier.map(incidentEndpointRoute),
		incidentEndpointRoute(path),
	]);
	return (
		elementContact(geometry, contract.endpointId, path) ??
		localRouteContact(geometry, source.bounds, path, bridges) ??
		earlierIncidentContact(path, earlier, bridges)
	);
}
