import { compareCanonicalStrings } from '../../canonical-string';
import { defined, LaneOrientation } from '../../document/logic-document';
import type { RoutingEdge } from '../geometry/routing-edge';
import { PORT_INSET, PORT_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import type {
	LaneSide,
	SharedLaneEndpoint,
	SharedLaneInput,
	SharedLanePlan,
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
	readonly oppositeLayoutOrder: string;
}

interface PortGroup {
	readonly endpointId: string;
	readonly side: LaneSide;
	readonly incidences: PortIncidence[];
}

interface IncidentFaceGroup {
	readonly endpointId: string;
	readonly side: RegionPortalSide;
	readonly contracts: RegionIncidentContract[];
}

export interface SharedLanePorts {
	readonly offsetByIncidence: ReadonlyMap<string, number>;
	readonly demandByEndpoint: ReadonlyMap<string, number>;
	readonly incidentOffsetByFace: ReadonlyMap<string, number>;
}

export function incidenceKey(relationId: string, role: PortRole): string {
	return JSON.stringify([relationId, role]);
}

export function incidentFaceKey(contract: RegionIncidentContract, side: RegionPortalSide): string {
	return JSON.stringify([contract.relation.id, contract.role, side]);
}

function physicalSide(input: SharedLaneInput, side: LaneSide): RegionPortalSide {
	if (input.orientation === LaneOrientation.Parallel) {
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
	readonly side: LaneSide;
	readonly role: PortRole;
}

function addIncidence(groups: Map<string, PortGroup>, input: IncidenceInput): void {
	const { plan, endpoint, other, side, role } = input;
	const key = JSON.stringify([endpoint.id, side]);
	let group = groups.get(key);
	if (group === undefined) {
		group = { endpointId: endpoint.id, side, incidences: [] };
		groups.set(key, group);
	}
	group.incidences.push({
		relationId: plan.id,
		role,
		sameLane: plan.sameLane,
		oppositeHalf: incidenceHalf(endpoint, other),
		laneOrder: -Math.abs(other.laneIndex - endpoint.laneIndex),
		oppositeRow: other.row,
		oppositeLayoutOrder: other.layoutOrder,
	});
}

function incidenceHalf(endpoint: SharedLaneEndpoint, other: SharedLaneEndpoint): number {
	if (other.laneIndex === endpoint.laneIndex) return 2;
	if (other.row > endpoint.row) return 1;
	return -1;
}

function compareIncidences(
	a: PortIncidence,
	b: PortIncidence,
	relationOrder: ReadonlyMap<string, number>,
): number {
	// Inter-lane passages on opposite halves of a face must not exchange their ports.
	const half = a.oppositeHalf - b.oppositeHalf;
	if (half !== 0) return half;
	// Within one half the farther lane takes the exterior port first.
	const lane = a.laneOrder - b.laneOrder;
	if (lane !== 0) return lane;
	// Same-lane U arcs nest; cross-lane routes preserve the opposite endpoints' along-lane order.
	let direction = 1;
	if (a.sameLane) direction = -1;
	const row = direction * (a.oppositeRow - b.oppositeRow);
	if (row !== 0) return row;
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
		const groupKey = JSON.stringify([endpointId, laneSide]);
		if (groups.has(groupKey)) continue;
		groups.set(groupKey, { endpointId, side: laneSide, incidences: [] });
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

export function planSharedLanePorts(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[] = [],
): SharedLanePorts {
	const relationOrder = new Map(input.plans.map(({ id }, index) => [id, index]));
	const groups = new Map<string, PortGroup>();
	for (const plan of input.plans) {
		const source = defined(input.endpoints.get(plan.from));
		const target = defined(input.endpoints.get(plan.to));
		addIncidence(groups, {
			plan,
			endpoint: source,
			other: target,
			side: plan.sourceSide,
			role: PortRole.Source,
		});
		addIncidence(groups, {
			plan,
			endpoint: target,
			other: source,
			side: plan.targetSide,
			role: PortRole.Target,
		});
	}
	const offsetByIncidence = new Map<string, number>();
	const demandByEndpoint = new Map<string, number>();
	const faces = incidentFaces(input, contracts, groups);
	const incidentOffsetByFace = incidentOffsets(faces, relationOrder);
	for (const group of groups.values()) {
		group.incidences.sort((a, b) => compareIncidences(a, b, relationOrder));
		const count = group.incidences.length;
		const side = physicalSide(input, group.side);
		const reserved = faces.get(JSON.stringify([group.endpointId, side]))?.contracts.length ?? 0;
		const spread = (count - 1) * PORT_SPACING;
		let required = 2 * PORT_INSET + spread;
		if (reserved > 0) {
			const furthestPort = Math.max(count, reserved - 1) * PORT_SPACING;
			required = 2 * (PORT_INSET + furthestPort);
		}
		demandByEndpoint.set(
			group.endpointId,
			Math.max(demandByEndpoint.get(group.endpointId) ?? 0, required),
		);
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
	return { offsetByIncidence, demandByEndpoint, incidentOffsetByFace };
}
