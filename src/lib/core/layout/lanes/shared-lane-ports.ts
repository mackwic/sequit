import { compareCanonicalStrings } from '../../canonical-string';
import { defined, LaneOrientation } from '../../document/logic-document';
import { PORT_SPACING } from '../layout-settings';
import { RegionPortalSide } from '../regions/model/region-composition-types';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import { faceDemand, facePortOffset } from './shared-lane-face-ports';
import {
	compareLayoutOrder,
	type LaneSide,
	type SharedLaneEndpoint,
	type SharedLaneInput,
	type SharedLanePlan,
} from './shared-lane-model';

export enum PortRole {
	Source = 'source',
	Target = 'target',
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
}

interface IncidentFaceGroup {
	readonly endpointId: string;
	readonly side: RegionPortalSide;
	readonly contracts: RegionIncidentContract[];
}

/** One port of a local route on a longitudinal face, before the frame orders the face. */
interface LocalPortIncidence {
	readonly relationId: string;
	readonly role: PortRole;
}

/** The ports a longitudinal face of a parallel endpoint holds for its local routes. */
interface LocalPortFace {
	readonly endpointId: string;
	readonly side: LaneSide;
	readonly incidences: readonly LocalPortIncidence[];
	/** Incident ports reserved on the same physical face: the local ports keep clear of them. */
	readonly reserved: number;
}

export interface SharedLanePorts {
	/** Offset from the face centre of every port a lane frame orders before placement. */
	readonly offsetByIncidence: ReadonlyMap<string, number>;
	/** Extent along the rank axis that the ports on an endpoint's cross faces demand. */
	readonly longDemandByEndpoint: ReadonlyMap<string, number>;
	/** Extent across the rank axis that the ports on an endpoint's longitudinal faces demand. */
	readonly crossDemandByEndpoint: ReadonlyMap<string, number>;
	readonly incidentOffsetByFace: ReadonlyMap<string, number>;
	/** The longitudinal faces holding local ports; the frame orders their ports once placed. */
	readonly localFaces: readonly LocalPortFace[];
}

export function incidenceKey(relationId: string, role: PortRole): string {
	return JSON.stringify([relationId, role]);
}

export function incidentFaceKey(contract: RegionIncidentContract, side: RegionPortalSide): string {
	return JSON.stringify([contract.relation.id, contract.role, side]);
}

/** The physical face of a logical side: a cross face, or a longitudinal face when `along`. */
function physicalSide(input: SharedLaneInput, side: LaneSide, along: boolean): RegionPortalSide {
	if (!along) {
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
}

function addIncidence(groups: Map<string, PortGroup>, input: IncidenceInput): void {
	const { plan, endpoint, other, otherPosition, side, role } = input;
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
		if (physicalSide(input, laneSide, input.orientation !== LaneOrientation.Parallel) !== side)
			continue;
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

/** The longitudinal faces of a parallel frame that hold local ports, with their reservations. */
function localPortFaces(
	input: SharedLaneInput,
	incidents: ReadonlyMap<string, IncidentFaceGroup>,
): readonly LocalPortFace[] {
	const faces = new Map<string, LocalPortFace & { readonly incidences: LocalPortIncidence[] }>();
	for (const plan of input.plans) {
		if (!plan.local) continue;
		const ends = [
			{ endpointId: plan.from, side: plan.sourceSide, role: PortRole.Source },
			{ endpointId: plan.to, side: plan.targetSide, role: PortRole.Target },
		];
		for (const { endpointId, side, role } of ends) {
			const key = JSON.stringify([endpointId, side]);
			let face = faces.get(key);
			if (face === undefined) {
				const physical = physicalSide(input, side, true);
				const reserved =
					incidents.get(JSON.stringify([endpointId, physical]))?.contracts.length ?? 0;
				face = { endpointId, side, incidences: [], reserved };
				faces.set(key, face);
			}
			face.incidences.push({ relationId: plan.id, role });
		}
	}
	return [...faces.values()];
}

export function planSharedLanePorts(
	input: SharedLaneInput,
	contracts: readonly RegionIncidentContract[] = [],
): SharedLanePorts {
	const relationOrder = new Map(input.plans.map(({ id }, index) => [id, index]));
	const positions = bandPositions(input);
	const groups = new Map<string, PortGroup>();
	for (const plan of input.plans) {
		if (plan.local) continue;
		const source = defined(input.endpoints.get(plan.from));
		const target = defined(input.endpoints.get(plan.to));
		addIncidence(groups, {
			plan,
			endpoint: source,
			other: target,
			otherPosition: defined(positions.get(target.id)),
			side: plan.sourceSide,
			role: PortRole.Source,
		});
		addIncidence(groups, {
			plan,
			endpoint: target,
			other: source,
			otherPosition: defined(positions.get(source.id)),
			side: plan.targetSide,
			role: PortRole.Target,
		});
	}
	const offsetByIncidence = new Map<string, number>();
	const longDemandByEndpoint = new Map<string, number>();
	const crossDemandByEndpoint = new Map<string, number>();
	const groupFacesAlong = input.orientation !== LaneOrientation.Parallel;
	let groupDemands = longDemandByEndpoint;
	if (groupFacesAlong) groupDemands = crossDemandByEndpoint;
	const faces = incidentFaces(input, contracts, groups);
	const incidentOffsetByFace = incidentOffsets(faces, relationOrder);
	for (const group of groups.values()) {
		const localOnly = group.incidences.every(({ sameLane }) => sameLane);
		group.incidences.sort((a, b) => compareIncidences(a, b, relationOrder, localOnly));
		const count = group.incidences.length;
		const side = physicalSide(input, group.side, groupFacesAlong);
		const reserved = faces.get(JSON.stringify([group.endpointId, side]))?.contracts.length ?? 0;
		const required = faceDemand(count, reserved);
		groupDemands.set(group.endpointId, Math.max(groupDemands.get(group.endpointId) ?? 0, required));
		for (const [index, incidence] of group.incidences.entries())
			offsetByIncidence.set(
				incidenceKey(incidence.relationId, incidence.role),
				facePortOffset(index, count, reserved),
			);
	}
	const localFaces = localPortFaces(input, faces);
	for (const face of localFaces) {
		const required = faceDemand(face.incidences.length, face.reserved);
		crossDemandByEndpoint.set(
			face.endpointId,
			Math.max(crossDemandByEndpoint.get(face.endpointId) ?? 0, required),
		);
	}
	return {
		offsetByIncidence,
		longDemandByEndpoint,
		crossDemandByEndpoint,
		incidentOffsetByFace,
		localFaces,
	};
}
