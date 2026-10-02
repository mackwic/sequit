import { compareCanonicalStrings } from '../../canonical-string';
import { defined, LaneOrientation } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import {
	compareLayoutOrder,
	type LaneSide,
	mainLaneFaces,
	type SharedLaneEndpoint,
	type SharedLaneInput,
	type SharedLanePlan,
} from './shared-lane-model';

export enum PortRole {
	Source = 'source',
	Target = 'target',
}

/**
 * The port edge of one lane-leaf face: the face publishes one track per `PORT_SPACING` slot between
 * its two insets, and two ports closer than that spacing share a track. The size demand of the face
 * (`demandByEndpoint`) is what grows the face until it publishes the tracks its ports request.
 */
export function facePortEdge(
	endpointId: string,
	side: RegionPortalSide,
	bounds: Bounds,
): RoutingEdge {
	const extent = faceExtent(bounds, side);
	const slots = (extent - 2 * PORT_INSET) / PORT_SPACING;
	return {
		ownerId: `${endpointId}/${side}`,
		capacity: Math.floor(slots) + 1,
		spacing: PORT_SPACING,
	};
}

function faceExtent(bounds: Bounds, side: RegionPortalSide): number {
	if (side === RegionPortalSide.Left || side === RegionPortalSide.Right) return bounds.height;
	return bounds.width;
}

interface PortIncidence {
	readonly relationId: string;
	readonly role: PortRole;
	readonly sameLane: boolean;
	readonly oppositeHalf: number;
	readonly laneOrder: number;
	readonly oppositeRow: number;
	readonly oppositePosition: number;
	readonly oppositeLayoutOrder: string;
}

interface PortGroup {
	readonly endpointId: string;
	readonly side: LaneSide;
	readonly incidences: PortIncidence[];
	readonly mainFace: boolean;
}

interface IncidentFaceGroup {
	readonly endpointId: string;
	readonly side: RegionPortalSide;
	readonly contracts: RegionIncidentContract[];
}

export interface SharedLanePorts {
	readonly offsetByIncidence: ReadonlyMap<string, number>;
	readonly demandByEndpoint: ReadonlyMap<string, number>;
	readonly crossDemandByEndpoint: ReadonlyMap<string, number>;
	readonly incidentOffsetByFace: ReadonlyMap<string, number>;
}

export function incidenceKey(relationId: string, role: PortRole): string {
	return JSON.stringify([relationId, role]);
}

export function incidentFaceKey(contract: RegionIncidentContract, side: RegionPortalSide): string {
	return JSON.stringify([contract.relation.id, contract.role, side]);
}

function physicalSide(input: SharedLaneInput, side: LaneSide, mainFace = false): RegionPortalSide {
	if (input.orientation === LaneOrientation.Parallel && !mainFace) {
		if (input.vertical) {
			if (side === -1) return RegionPortalSide.Left;
			return RegionPortalSide.Right;
		}
		if (side === -1) return RegionPortalSide.Top;
		return RegionPortalSide.Bottom;
	}
	let physical: number = side;
	if (input.reverse) physical = -side;
	if (input.vertical) {
		if (physical === -1) return RegionPortalSide.Top;
		return RegionPortalSide.Bottom;
	}
	if (physical === -1) return RegionPortalSide.Left;
	return RegionPortalSide.Right;
}

interface IncidenceInput {
	readonly plan: SharedLanePlan;
	readonly endpoint: SharedLaneEndpoint;
	readonly other: SharedLaneEndpoint;
	readonly otherPosition: number;
	readonly side: LaneSide;
	readonly role: PortRole;
	readonly mainFace: boolean;
}

function addIncidence(groups: Map<string, PortGroup>, input: IncidenceInput): void {
	const { plan, endpoint, other, otherPosition, role, mainFace } = input;
	let side = input.side;
	if (mainFace) {
		side = -1;
		if (other.row > endpoint.row) side = 1;
	}
	const key = JSON.stringify([endpoint.id, side, mainFace]);
	let group = groups.get(key);
	if (group === undefined) {
		group = { endpointId: endpoint.id, side, mainFace, incidences: [] };
		groups.set(key, group);
	}
	group.incidences.push({
		relationId: plan.id,
		role,
		sameLane: plan.sameLane,
		oppositeHalf: incidenceHalf(endpoint, other),
		laneOrder: -Math.abs(other.laneIndex - endpoint.laneIndex),
		oppositeRow: other.row,
		oppositePosition: otherPosition,
		oppositeLayoutOrder: other.layoutOrder,
	});
}

function incidenceHalf(endpoint: SharedLaneEndpoint, other: SharedLaneEndpoint): number {
	if (other.row > endpoint.row) return 1;
	if (other.row < endpoint.row) return -1;
	return 0;
}

function compareIncidences(
	a: PortIncidence,
	b: PortIncidence,
	relationOrder: ReadonlyMap<string, number>,
	localOnly: boolean,
): number {
	// All arcs, including local U arcs, keep distinct before/equal/after parts of the face.
	const half = a.oppositeHalf - b.oppositeHalf;
	if (half !== 0) return half;
	// Within each half only local U arcs reverse their order; inter-lane routes follow their rows.
	let direction = 1;
	if (localOnly) direction = -1;
	const row = direction * (a.oppositeRow - b.oppositeRow);
	if (row !== 0) return row;
	if (a.sameLane !== b.sameLane) {
		let localOrder = Number(b.sameLane) - Number(a.sameLane);
		if (a.oppositeHalf > 0) localOrder = -localOrder;
		return localOrder;
	}
	const position = direction * (a.oppositePosition - b.oppositePosition);
	if (position !== 0) return position;
	const lane = a.laneOrder - b.laneOrder;
	if (lane !== 0) return lane;
	const other = direction * compareCanonicalStrings(a.oppositeLayoutOrder, b.oppositeLayoutOrder);
	if (other !== 0) return other;
	const relation =
		defined(relationOrder.get(a.relationId)) - defined(relationOrder.get(b.relationId));
	if (relation !== 0) return relation;
	return compareCanonicalStrings(a.relationId, b.relationId);
}

function reservePhysicalGroup(
	input: SharedLaneInput,
	groups: Map<string, PortGroup>,
	endpointId: string,
	side: RegionPortalSide,
): void {
	for (const laneSide of [-1, 1] as const) {
		if (physicalSide(input, laneSide) !== side) continue;
		const groupKey = JSON.stringify([endpointId, laneSide, false]);
		if (groups.has(groupKey)) continue;
		groups.set(groupKey, { endpointId, side: laneSide, mainFace: false, incidences: [] });
	}
}

function incidentFaces(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[],
	groups: Map<string, PortGroup>,
): ReadonlyMap<string, IncidentFaceGroup> {
	const faces = new Map<string, IncidentFaceGroup>();
	for (const contract of contracts) {
		for (const side of contract.allowedSides) {
			const key = JSON.stringify([contract.endpointId, side]);
			let face = faces.get(key);
			if (face === undefined) {
				face = { endpointId: contract.endpointId, side, contracts: [] };
				faces.set(key, face);
			}
			face.contracts.push(contract);
			reservePhysicalGroup(input, groups, contract.endpointId, side);
		}
	}
	return faces;
}

function compareContracts(
	left: RegionIncidentContract,
	right: RegionIncidentContract,
	relationOrder: ReadonlyMap<string, number>,
): number {
	const leftOrder = relationOrder.get(left.relation.id);
	const rightOrder = relationOrder.get(right.relation.id);
	if (leftOrder !== undefined && rightOrder !== undefined) {
		const order = leftOrder - rightOrder;
		if (order !== 0) return order;
	} else if (leftOrder !== undefined) return -1;
	else if (rightOrder !== undefined) return 1;
	const source = compareCanonicalStrings(left.relation.from, right.relation.from);
	if (source !== 0) return source;
	const target = compareCanonicalStrings(left.relation.to, right.relation.to);
	if (target !== 0) return target;
	return compareCanonicalStrings(left.role, right.role);
}

function incidentOffsets(
	faces: ReadonlyMap<string, IncidentFaceGroup>,
	relationOrder: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
	const offsets = new Map<string, number>();
	for (const face of faces.values()) {
		face.contracts.sort((left, right) => compareContracts(left, right, relationOrder));
		for (const [index, contract] of face.contracts.entries())
			offsets.set(incidentFaceKey(contract, face.side), index * PORT_SPACING);
	}
	return offsets;
}

function bandPositions(input: SharedLaneInput): ReadonlyMap<string, number> {
	const ordered = [...input.endpoints.values()].sort((a, b) => {
		const lane = a.laneIndex - b.laneIndex;
		if (lane !== 0) return lane;
		const row = a.row - b.row;
		if (row !== 0) return row;
		return compareLayoutOrder(a, b);
	});
	const positions = new Map<string, number>();
	let previousLane = -1;
	let previousRow = -1;
	let position = 0;
	for (const endpoint of ordered) {
		if (endpoint.laneIndex !== previousLane || endpoint.row !== previousRow) position = 0;
		positions.set(endpoint.id, position);
		position += 1;
		previousLane = endpoint.laneIndex;
		previousRow = endpoint.row;
	}
	return positions;
}

export function planSharedLanePorts(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[] = [],
): SharedLanePorts {
	const relationOrder = new Map(input.plans.map(({ id }, index) => [id, index]));
	const positions = bandPositions(input);
	const groups = new Map<string, PortGroup>();
	for (const plan of input.plans) {
		const source = defined(input.endpoints.get(plan.from));
		const target = defined(input.endpoints.get(plan.to));
		const mainFace = mainLaneFaces(input, plan);
		addIncidence(groups, {
			plan,
			endpoint: source,
			other: target,
			otherPosition: defined(positions.get(target.id)),
			side: plan.sourceSide,
			role: PortRole.Source,
			mainFace,
		});
		addIncidence(groups, {
			plan,
			endpoint: target,
			other: source,
			otherPosition: defined(positions.get(source.id)),
			side: plan.targetSide,
			role: PortRole.Target,
			mainFace,
		});
	}
	const offsetByIncidence = new Map<string, number>();
	const demandByEndpoint = new Map<string, number>();
	const crossDemandByEndpoint = new Map<string, number>();
	const faces = incidentFaces(input, contracts, groups);
	const incidentOffsetByFace = incidentOffsets(faces, relationOrder);
	for (const group of groups.values()) {
		const localOnly = !group.mainFace && group.incidences.every(({ sameLane }) => sameLane);
		group.incidences.sort((a, b) => compareIncidences(a, b, relationOrder, localOnly));
		const count = group.incidences.length;
		const side = physicalSide(input, group.side, group.mainFace);
		const reserved = faces.get(JSON.stringify([group.endpointId, side]))?.contracts.length ?? 0;
		const spread = (count - 1) * PORT_SPACING;
		let required = 2 * PORT_INSET + spread;
		if (reserved > 0) {
			const furthestPort = Math.max(count, reserved - 1) * PORT_SPACING;
			required = 2 * (PORT_INSET + furthestPort);
		}
		let demand = demandByEndpoint;
		if (group.mainFace) demand = crossDemandByEndpoint;
		demand.set(group.endpointId, Math.max(demand.get(group.endpointId) ?? 0, required));
		for (const [index, incidence] of group.incidences.entries()) {
			const center = (count - 1) / 2;
			let offset = (index - center) * PORT_SPACING;
			if (reserved > 0) {
				const portIndex = count - index;
				offset = -portIndex * PORT_SPACING;
			}
			offsetByIncidence.set(incidenceKey(incidence.relationId, incidence.role), offset);
		}
	}
	return { offsetByIncidence, demandByEndpoint, crossDemandByEndpoint, incidentOffsetByFace };
}
