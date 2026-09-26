import { compareCanonicalStrings } from '../canonical-string';
import type { LogicRelation } from '../document/logic-document';
import type { BoundedSearchWitness } from './bounded-search';
import type { Point } from './layout-types';
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
	readonly blockedEndpointId?: string;
	readonly blockedRelationId?: string;
	readonly blockedIncidentRelationId?: string;
	readonly exhausted?: true;
	readonly code: RegionIncidentRejectionCode;
	readonly reason?: string;
}

/** A bounded search reports whether its listed attempts exhaust the declared alternatives. */
export type RegionIncidentSearchWitness = BoundedSearchWitness<RegionIncidentRejectedAlternative>;

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

/** Sort incident identities, preserve side preference, and reject ambiguous duplicates. */
export function normalizeRegionIncidentContracts(
	contracts: readonly RegionIncidentContract[],
): readonly RegionIncidentContract[] {
	const byIdentity = new Map<string, RegionIncidentContract>();
	for (const contract of contracts) {
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
		const normalized: RegionIncidentContract = Object.freeze({
			relation: Object.freeze({
				id: relation.id,
				from: relation.from,
				to: relation.to,
			}),
			endpointId,
			role,
			allowedSides: normalizedSides(contract.allowedSides),
		});
		const key = JSON.stringify([relation.id, role]);
		const existing = byIdentity.get(key);
		if (existing !== undefined && !sameContract(existing, normalized))
			throw new Error(`Conflicting incident contract for relation ${relation.id} ${role}.`);
		byIdentity.set(key, normalized);
	}
	return Object.freeze(
		[...byIdentity.values()].sort((left, right) => {
			const relationOrder = compareCanonicalStrings(left.relation.id, right.relation.id);
			if (relationOrder !== 0) return relationOrder;
			return compareCanonicalStrings(left.role, right.role);
		}),
	);
}
