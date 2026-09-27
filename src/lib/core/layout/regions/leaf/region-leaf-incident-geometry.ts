import { EndpointKind } from '../../../document/logic-document';
import { disallowedProvisionalRouteContacts } from '../../bridges/bridge-contact';
import {
	inside,
	orthogonal,
	segmentEnters,
} from '../../geometry/nested-region-geometry-primitives';
import type { Bounds, LayoutElement, LayoutResult, Point } from '../../layout-types';
import type { SearchBudgetCounter } from '../../search/bounded-search';
import { incidentEndpointRoute } from '../composition/region-incident-contact';
import { RegionPortalSide } from '../model/region-composition-types';
import type {
	RegionIncidentContract,
	RegionSolvedIncident,
} from '../model/region-incident-contract';
import { RegionIncidentRejectionCode, RegionIncidentRole } from '../model/region-incident-contract';

const CORRIDOR_CLEARANCE = 8;

export interface FaceSlot {
	readonly side: RegionPortalSide;
	readonly preferredFraction: number;
}

export interface RegionLeafIncidentGeometryFailure {
	readonly code: RegionIncidentRejectionCode;
	readonly reason: string;
	readonly candidateId?: string;
	readonly exhausted?: true;
}

function isVertical(side: RegionPortalSide): boolean {
	return side === RegionPortalSide.Top || side === RegionPortalSide.Bottom;
}

export function faceAnchor(bounds: Bounds, side: RegionPortalSide, fraction: number): Point {
	if (side === RegionPortalSide.Top) return { x: bounds.x + bounds.width * fraction, y: bounds.y };
	if (side === RegionPortalSide.Bottom)
		return {
			x: bounds.x + bounds.width * fraction,
			y: bounds.y + bounds.height,
		};
	if (side === RegionPortalSide.Left)
		return { x: bounds.x, y: bounds.y + bounds.height * fraction };
	return { x: bounds.x + bounds.width, y: bounds.y + bounds.height * fraction };
}

function boundaryPoint(anchor: Point, side: RegionPortalSide, layout: LayoutResult): Point {
	if (side === RegionPortalSide.Top) return { x: anchor.x, y: 0 };
	if (side === RegionPortalSide.Bottom) return { x: anchor.x, y: layout.height };
	if (side === RegionPortalSide.Left) return { x: 0, y: anchor.y };
	return { x: layout.width, y: anchor.y };
}

function faceInterior(anchor: Point, bounds: Bounds, side: RegionPortalSide): boolean {
	const right = bounds.x + bounds.width;
	const bottom = bounds.y + bounds.height;
	if (isVertical(side)) return anchor.x > bounds.x && anchor.x < right;
	return anchor.y > bounds.y && anchor.y < bottom;
}

function boundaryInterior(portal: Point, side: RegionPortalSide, layout: LayoutResult): boolean {
	if (isVertical(side)) return portal.x > 0 && portal.x < layout.width;
	return portal.y > 0 && portal.y < layout.height;
}

export function slotFractions(preferred: number): readonly number[] {
	return [...new Set([preferred, 0.5, 0.25, 0.75, 0.125, 0.875])];
}

interface SlotGroup {
	readonly side: RegionPortalSide;
	readonly targets: number[];
	readonly sources: number[];
}

function slotGroups(
	contracts: readonly RegionIncidentContract[],
	sides: readonly RegionPortalSide[],
	work?: SearchBudgetCounter,
): Map<string, SlotGroup> | undefined {
	const groups = new Map<string, SlotGroup>();
	for (const [index, contract] of contracts.entries()) {
		const side = sides[index];
		if (side === undefined) throw new Error('The side assignment is incomplete.');
		if (work !== undefined && !work.take()) return undefined;
		const key = JSON.stringify([contract.endpointId, side]);
		let group = groups.get(key);
		if (group === undefined) {
			group = { side, targets: [], sources: [] };
			groups.set(key, group);
		}
		// The role order and original indices reproduce the old stable comparator.
		if (contract.role === RegionIncidentRole.Target) group.targets.push(index);
		else group.sources.push(index);
	}
	return groups;
}

export function slotsForAssignment(
	contracts: readonly RegionIncidentContract[],
	sides: readonly RegionPortalSide[],
): readonly FaceSlot[];
export function slotsForAssignment(
	contracts: readonly RegionIncidentContract[],
	sides: readonly RegionPortalSide[],
	work: SearchBudgetCounter,
): readonly FaceSlot[] | undefined;
export function slotsForAssignment(
	contracts: readonly RegionIncidentContract[],
	sides: readonly RegionPortalSide[],
	work?: SearchBudgetCounter,
): readonly FaceSlot[] | undefined {
	const groups = slotGroups(contracts, sides, work);
	if (groups === undefined) return undefined;
	const slots: FaceSlot[] = [];
	for (const group of groups.values()) {
		const denominator = group.targets.length + group.sources.length + 1;
		let ordinal = 1;
		for (const index of group.targets) {
			if (work !== undefined && !work.take()) return undefined;
			slots[index] = { side: group.side, preferredFraction: ordinal / denominator };
			ordinal += 1;
		}
		for (const index of group.sources) {
			if (work !== undefined && !work.take()) return undefined;
			slots[index] = { side: group.side, preferredFraction: ordinal / denominator };
			ordinal += 1;
		}
	}
	return slots;
}

function detourCoordinates(
	anchor: Point,
	side: RegionPortalSide,
	layout: LayoutResult,
): readonly number[] {
	let origin = anchor.y;
	let maximum = layout.height;
	if (isVertical(side)) {
		origin = anchor.x;
		maximum = layout.width;
	}
	const firstQuarter = maximum / 4;
	const thirdQuarter = (maximum * 3) / 4;
	const edgeCorridor = CORRIDOR_CLEARANCE * 2;
	const coordinates = [
		origin - 24,
		origin + 24,
		firstQuarter,
		thirdQuarter,
		edgeCorridor,
		maximum - edgeCorridor,
	];
	return [
		...new Set(coordinates.filter((coordinate) => coordinate > 0 && coordinate < maximum)),
	].sort((left, right) => {
		const distanceDifference = Math.abs(left - origin) - Math.abs(right - origin);
		return distanceDifference || left - right;
	});
}

export function routeCandidates(
	anchor: Point,
	side: RegionPortalSide,
	layout: LayoutResult,
): readonly (readonly Point[])[] {
	const portal = boundaryPoint(anchor, side, layout);
	const routes: Point[][] = [[anchor, portal]];
	const vertical = isVertical(side);
	let distance = Math.abs(anchor.x - portal.x);
	if (vertical) distance = Math.abs(anchor.y - portal.y);
	if (distance <= CORRIDOR_CLEARANCE * 2) return routes;
	let sign = 1;
	if (side === RegionPortalSide.Top || side === RegionPortalSide.Left) sign = -1;
	const bends = [CORRIDOR_CLEARANCE, distance / 2];
	for (const bend of bends)
		for (const coordinate of detourCoordinates(anchor, side, layout)) {
			if (vertical) {
				const level = anchor.y + sign * bend;
				routes.push([
					anchor,
					{ x: anchor.x, y: level },
					{ x: coordinate, y: level },
					{ x: coordinate, y: portal.y },
				]);
			} else {
				const level = anchor.x + sign * bend;
				routes.push([
					anchor,
					{ x: level, y: anchor.y },
					{ x: level, y: coordinate },
					{ x: portal.x, y: coordinate },
				]);
			}
		}
	return routes;
}

function outsideCanvas(point: Point, layout: LayoutResult): boolean {
	if (point.x < 0 || point.x > layout.width) return true;
	return point.y < 0 || point.y > layout.height;
}

function routeContactFailure(
	layout: LayoutResult,
	path: RegionSolvedIncident,
	selected: readonly RegionSolvedIncident[],
): RegionLeafIncidentGeometryFailure | undefined {
	const incident = incidentEndpointRoute(path);
	const earlier = selected.map(incidentEndpointRoute);
	for (const local of layout.relations)
		if (disallowedProvisionalRouteContacts(incident, local).length > 0)
			return {
				code: RegionIncidentRejectionCode.RouteObstructed,
				reason: `The incident route touches local relation ${local.id}.`,
			};
	for (const other of earlier)
		if (disallowedProvisionalRouteContacts(incident, other).length > 0)
			return {
				code: RegionIncidentRejectionCode.RouteObstructed,
				reason: `The incident route touches incident ${other.id}.`,
			};
	return undefined;
}

export function geometryFailure(
	layout: LayoutResult,
	endpoint: LayoutElement,
	path: RegionSolvedIncident,
	selected: readonly RegionSolvedIncident[],
): RegionLeafIncidentGeometryFailure | undefined {
	if (!faceInterior(path.anchor, endpoint.bounds, path.side))
		return {
			code: RegionIncidentRejectionCode.InvalidAttachment,
			reason: 'The incident anchor misses the endpoint face.',
		};
	if (!boundaryInterior(path.portal, path.side, layout) || !orthogonal(path.points))
		return {
			code: RegionIncidentRejectionCode.GeometryInvalid,
			reason: 'The incident route misses an open frame side or is not orthogonal.',
		};
	if (path.points.some((point) => outsideCanvas(point, layout)))
		return {
			code: RegionIncidentRejectionCode.GeometryInvalid,
			reason: 'The incident route leaves the local canvas.',
		};
	for (const element of layout.elements) {
		// A member may cross its own containing group to leave the leaf. The group
		// boundary is checked again by the composition validator.
		if (element.kind === EndpointKind.Group && inside(element.bounds, endpoint.bounds)) continue;
		if (segmentEnters(path.points, element.bounds))
			return {
				code: RegionIncidentRejectionCode.RouteObstructed,
				reason: `The incident route enters endpoint ${element.id}.`,
			};
	}
	return routeContactFailure(layout, path, selected);
}

export function routeFor(
	contract: RegionIncidentContract,
	side: RegionPortalSide,
	points: readonly Point[],
): RegionSolvedIncident {
	const anchor = points[0];
	const portal = points.at(-1);
	if (anchor === undefined || portal === undefined) throw new Error('An incident route is empty.');
	return {
		relationId: contract.relation.id,
		endpointId: contract.endpointId,
		role: contract.role,
		side,
		anchor,
		portal,
		points,
	};
}
