import { compareCanonicalStrings } from '../canonical-string';
import { defined, LaneOrientation } from '../document/logic-document';
import { PORT_INSET, PORT_SPACING } from './layout-settings';
import type { Bounds } from './layout-types';
import { RegionPortalSide } from './region-composition-types';
import type { RegionIncidentContract } from './region-incident-contract';
import type { RoutingEdge } from './routing-resource-allocation';
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
	readonly oppositeRow: number;
	readonly oppositeId: string;
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
		oppositeRow: other.row,
		oppositeId: other.id,
	});
}

function compareIncidences(a: PortIncidence, b: PortIncidence): number {
	const row = a.oppositeRow - b.oppositeRow;
	if (row !== 0) return row;
	const other = compareCanonicalStrings(a.oppositeId, b.oppositeId);
	if (other !== 0) return other;
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

function compareContracts(left: RegionIncidentContract, right: RegionIncidentContract): number {
	const relation = compareCanonicalStrings(left.relation.id, right.relation.id);
	if (relation !== 0) return relation;
	return compareCanonicalStrings(left.role, right.role);
}

function incidentOffsets(
	faces: ReadonlyMap<string, IncidentFaceGroup>,
): ReadonlyMap<string, number> {
	const offsets = new Map<string, number>();
	for (const face of faces.values()) {
		face.contracts.sort(compareContracts);
		for (const [index, contract] of face.contracts.entries())
			offsets.set(incidentFaceKey(contract, face.side), index * PORT_SPACING);
	}
	return offsets;
}

export function planSharedLanePorts(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[] = [],
): SharedLanePorts {
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
	const incidentOffsetByFace = incidentOffsets(faces);
	for (const group of groups.values()) {
		group.incidences.sort(compareIncidences);
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
				const portIndex = index + 1;
				offset = -portIndex * PORT_SPACING;
			}
			offsetByIncidence.set(incidenceKey(incidence.relationId, incidence.role), offset);
		}
	}
	return { offsetByIncidence, demandByEndpoint, incidentOffsetByFace };
}
