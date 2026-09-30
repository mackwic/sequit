import { compareCanonicalStrings } from '../../../canonical-string';
import type { LogicDocument, LogicEndpoint, LogicRelation } from '../../../document/logic-document';
import type { Point } from '../../layout-types';
import type { BoundedSearchWitness } from '../../search/bounded-search';
import { RegionPortalSide } from './region-portal-side';

export enum RegionIncidentRole {
	Source = 'source',
	Target = 'target',
}

/** The parent supplies every incident to a leaf, including its preferred frame sides. */
export interface RegionIncidentContract {
	readonly relation: LogicRelation;
	readonly endpointId: string;
	readonly role: RegionIncidentRole;
	readonly allowedSides: readonly RegionPortalSide[];
}

interface IncidentSpan {
	readonly start: number;
	readonly end: number;
}

interface OrderedIncidentContract {
	readonly contract: RegionIncidentContract;
	readonly span: IncidentSpan | undefined;
	nesting: number;
}

/** Assign documentary endpoint positions across groups, nodes, and junctions. */
export function incidentEndpointPositions(document: LogicDocument): ReadonlyMap<string, number> {
	const endpoints: LogicEndpoint[] = [...document.groups, ...document.nodes, ...document.junctions];
	endpoints.sort(
		(left, right) =>
			compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
			compareCanonicalStrings(left.id, right.id),
	);
	const positions = new Map<string, number>();
	for (const [position, endpoint] of endpoints.entries()) positions.set(endpoint.id, position);
	return positions;
}

/** Compare documentary positions; absent external endpoints fall back to stable endpoint IDs. */
function compareEndpointPositions(
	leftId: string,
	rightId: string,
	positions: ReadonlyMap<string, number> | undefined,
): number {
	const leftPosition = positions?.get(leftId);
	const rightPosition = positions?.get(rightId);
	if (leftPosition !== undefined && rightPosition !== undefined)
		return leftPosition - rightPosition;
	if (leftPosition !== undefined) return -1;
	if (rightPosition !== undefined) return 1;
	return compareCanonicalStrings(leftId, rightId);
}

function compareIncidentContracts(
	left: RegionIncidentContract,
	right: RegionIncidentContract,
	positions: ReadonlyMap<string, number> | undefined,
): number {
	const endpointOrder = compareEndpointPositions(left.endpointId, right.endpointId, positions);
	if (endpointOrder !== 0) return endpointOrder;
	if (left.role !== right.role) {
		if (left.role === RegionIncidentRole.Source) return -1;
		return 1;
	}
	let leftOppositeId = left.relation.from;
	let rightOppositeId = right.relation.from;
	if (left.role === RegionIncidentRole.Source) {
		leftOppositeId = left.relation.to;
		rightOppositeId = right.relation.to;
	}
	const oppositeOrder = compareEndpointPositions(leftOppositeId, rightOppositeId, positions);
	if (oppositeOrder !== 0) return oppositeOrder;
	return compareCanonicalStrings(left.relation.id, right.relation.id);
}

function incidentSpan(
	contract: RegionIncidentContract,
	positions: ReadonlyMap<string, number> | undefined,
): IncidentSpan | undefined {
	let oppositeId = contract.relation.from;
	if (contract.role === RegionIncidentRole.Source) oppositeId = contract.relation.to;
	const endpointPosition = positions?.get(contract.endpointId);
	const oppositePosition = positions?.get(oppositeId);
	if (endpointPosition === undefined || oppositePosition === undefined) return undefined;
	return {
		start: Math.min(endpointPosition, oppositePosition),
		end: Math.max(endpointPosition, oppositePosition),
	};
}

function countIncidentSpanNesting(entries: OrderedIncidentContract[]): void {
	for (const entry of entries) {
		const span = entry.span;
		if (span === undefined) continue;
		for (const other of entries) {
			const outer = other.span;
			if (other === entry || outer === undefined) continue;
			if (outer.start < span.start && span.end < outer.end) entry.nesting += 1;
		}
	}
}

function compareOrderedIncidentContracts(
	left: OrderedIncidentContract,
	right: OrderedIncidentContract,
	positions: ReadonlyMap<string, number> | undefined,
): number {
	if (left.span === undefined && right.span !== undefined) return 1;
	if (left.span !== undefined && right.span === undefined) return -1;
	if (left.span !== undefined && right.span !== undefined) {
		const nesting = right.nesting - left.nesting;
		if (nesting !== 0) return nesting;
		const leftLength = left.span.end - left.span.start;
		const rightLength = right.span.end - right.span.start;
		if (leftLength !== rightLength) return leftLength - rightLength;
	}
	return compareIncidentContracts(left.contract, right.contract, positions);
}

/** Inner relation spans receive the earlier slots; document order breaks geometric ties. */
export function normalizeRegionIncidentContracts(
	contracts: readonly RegionIncidentContract[],
	positions?: ReadonlyMap<string, number>,
): readonly RegionIncidentContract[] {
	const byIdentity = new Map<string, RegionIncidentContract>();
	for (const contract of contracts) {
		const normalized = normalizeIncidentContract(contract);
		const key = JSON.stringify([normalized.relation.id, normalized.role]);
		const existing = byIdentity.get(key);
		if (existing !== undefined && !sameContract(existing, normalized))
			throw new Error(
				`Conflicting incident contract for relation ${normalized.relation.id} ${normalized.role}.`,
			);
		byIdentity.set(key, normalized);
	}
	const ordered: OrderedIncidentContract[] = [...byIdentity.values()].map((contract) => ({
		contract,
		span: incidentSpan(contract, positions),
		nesting: 0,
	}));
	countIncidentSpanNesting(ordered);
	ordered.sort((left, right) => compareOrderedIncidentContracts(left, right, positions));
	return Object.freeze(ordered.map(({ contract }) => contract));
}

/** The portal lies on the local layout edge, before region-frame padding. Points run anchor to portal for either role. */
export interface RegionSolvedIncident {
	readonly relationId: string;
	readonly endpointId: string;
	readonly role: RegionIncidentRole;
	readonly side: RegionPortalSide;
	readonly anchor: Point;
	readonly portal: Point;
	readonly points: readonly Point[];
}

export enum RegionIncidentUnknownCode {
	NoValidAlternative = 'no-valid-alternative',
	SearchBudgetExceeded = 'search-budget-exceeded',
	UnsupportedLeafPolicy = 'unsupported-leaf-policy',
	InvalidContract = 'invalid-contract',
}

export enum RegionIncidentRejectionCode {
	UnsupportedSide = 'unsupported-side',
	PortUnavailable = 'port-unavailable',
	RouteObstructed = 'route-obstructed',
	InvalidAttachment = 'invalid-attachment',
	GeometryInvalid = 'geometry-invalid',
}

/** One attempted side and the typed reason it was rejected. */
export interface RegionIncidentRejectedAlternative {
	readonly relationId: string;
	readonly endpointId: string;
	readonly role: RegionIncidentRole;
	readonly side: RegionPortalSide;
	readonly candidateId?: string;
	readonly exhausted?: true;
	readonly code: RegionIncidentRejectionCode;
	readonly reason?: string;
}

/** Route attempts and independently counted work used to construct side assignments. */
export type RegionIncidentSearchWitness =
	BoundedSearchWitness<RegionIncidentRejectedAlternative> & {
		readonly slotWork?: {
			readonly attempted: number;
			readonly limit: number;
			readonly exhausted: boolean;
		};
	};

const ALL_SIDES = new Set<RegionPortalSide>(Object.values(RegionPortalSide));
const ALL_ROLES = new Set<string>(Object.values(RegionIncidentRole));

function normalizedSides(sides: readonly RegionPortalSide[]): readonly RegionPortalSide[] {
	if (sides.length === 0) throw new Error('An incident must admit at least one frame side.');
	const unique = new Set<RegionPortalSide>();
	for (const side of sides) {
		if (!ALL_SIDES.has(side)) throw new Error(`Unknown incident frame side ${side}.`);
		unique.add(side);
	}
	return Object.freeze([...unique]);
}

function sameContract(left: RegionIncidentContract, right: RegionIncidentContract): boolean {
	if (left.relation.from !== right.relation.from) return false;
	if (left.relation.to !== right.relation.to) return false;
	if (left.allowedSides.length !== right.allowedSides.length) return false;
	return left.allowedSides.every((side, index) => side === right.allowedSides[index]);
}

function normalizeIncidentContract(contract: RegionIncidentContract): RegionIncidentContract {
	const { relation, endpointId, role } = contract;
	if (!ALL_ROLES.has(role)) throw new Error(`Unknown incident role ${role}.`);
	if (relation.id.length === 0)
		throw new Error('Incident relation identities and endpoints must be nonempty.');
	if (relation.from.length === 0 || relation.to.length === 0)
		throw new Error('Incident relation identities and endpoints must be nonempty.');
	let expectedEndpoint = relation.from;
	if (role === RegionIncidentRole.Target) expectedEndpoint = relation.to;
	if (endpointId !== expectedEndpoint)
		throw new Error(`Incident ${relation.id} ${role} endpoint must be ${expectedEndpoint}.`);
	return Object.freeze({
		relation: Object.freeze({
			id: relation.id,
			from: relation.from,
			to: relation.to,
		}),
		endpointId,
		role,
		allowedSides: normalizedSides(contract.allowedSides),
	});
}
