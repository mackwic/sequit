import { boundedCounter, scopedCounter, type SearchBudgetCounter } from './bounded-search';
import type { RankAdmission } from './rank-order-selection';
import type { RegionPortalSide } from './region-composition-types';
import {
	type RegionIncidentContract,
	type RegionIncidentRejectedAlternative,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';
import type { RegionLeafIncidentGeometryFailure } from './region-leaf-incident-geometry';

const MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT = 1_024;
const MAX_ALTERNATIVES = 8_192;

export interface SearchState {
	attempted: number;
	assignmentAttempts: number;
	assignmentLimitReached: boolean;
	budgetExceeded: boolean;
	incomplete: boolean;
	readonly rejected: RegionIncidentRejectedAlternative[];
	/** The alternative budget: the per-assignment cap composed under the global cap. */
	readonly budget: SearchBudgetCounter;
}

/**
 * The leaf's budget composes a per-assignment cap under the global cap over the state's own witness
 * fields, so a new side assignment restarts the scoped count and a capped assignment leaves the
 * search incomplete even when a later one succeeds.
 */
export function newSearchState(): SearchState {
	const state: SearchState = {
		attempted: 0,
		assignmentAttempts: 0,
		assignmentLimitReached: false,
		budgetExceeded: false,
		incomplete: false,
		rejected: [],
		budget: scopedCounter(
			boundedCounter(MAX_ALTERNATIVES, {
				get attempted(): number {
					return state.attempted;
				},
				set attempted(value: number) {
					state.attempted = value;
				},
				get exhausted(): boolean {
					return state.budgetExceeded;
				},
				set exhausted(value: boolean) {
					state.budgetExceeded = value;
				},
			}),
			MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT,
			{
				get attempted(): number {
					return state.assignmentAttempts;
				},
				set attempted(value: number) {
					state.assignmentAttempts = value;
				},
				get exhausted(): boolean {
					return state.assignmentLimitReached;
				},
				set exhausted(value: boolean) {
					state.assignmentLimitReached = value;
					state.incomplete = value;
				},
			},
		),
	};
	return state;
}

export function witness(state: SearchState, exhaustive: boolean): RegionIncidentSearchWitness {
	return {
		attempted: state.attempted,
		exhaustive,
		rejectedAlternatives: state.rejected,
	};
}

export function recordRejection(
	state: SearchState,
	contract: RegionIncidentContract,
	side: RegionPortalSide,
	failure: RegionLeafIncidentGeometryFailure,
): void {
	const alternative: RegionIncidentRejectedAlternative = {
		relationId: contract.relation.id,
		endpointId: contract.endpointId,
		role: contract.role,
		side,
		...failure,
	};
	state.rejected.push(alternative);
}

export function takeAttempt(state: SearchState): boolean {
	return state.budget.take();
}

function recordBlockers(
	rejected: RegionIncidentRejectedAlternative,
	byRelation: ReadonlyMap<string, string>,
	endpoints: Set<string>,
	relations: Set<string>,
): boolean {
	if (rejected.code === RegionIncidentRejectionCode.GeometryInvalid) return false;
	endpoints.add(rejected.endpointId);
	if (rejected.code !== RegionIncidentRejectionCode.RouteObstructed) return true;
	const { blockedEndpointId, blockedRelationId, blockedIncidentRelationId } = rejected;
	if (blockedEndpointId === undefined && blockedRelationId === undefined) {
		if (blockedIncidentRelationId === undefined) return false;
	}
	if (blockedEndpointId !== undefined) endpoints.add(blockedEndpointId);
	if (blockedRelationId !== undefined) relations.add(blockedRelationId);
	if (blockedIncidentRelationId === undefined) return true;
	const endpointId = byRelation.get(blockedIncidentRelationId);
	if (endpointId === undefined) return false;
	endpoints.add(endpointId);
	return true;
}

/** Exhaustive failures identify an incident and every concrete blocker; missing provenance is global. */
export function rejectedIncidentAdmission(
	attempt: {
		readonly code: RegionIncidentUnknownCode;
		readonly witness: RegionIncidentSearchWitness;
	},
	contracts: readonly RegionIncidentContract[],
): RankAdmission {
	if (attempt.code !== RegionIncidentUnknownCode.NoValidAlternative) return false;
	if (!attempt.witness.exhaustive) return false;
	const endpoints = new Set<string>();
	const relations = new Set<string>();
	const byRelation = new Map(
		contracts.map((contract) => [contract.relation.id, contract.endpointId]),
	);
	let concrete = false;
	for (const rejected of attempt.witness.rejectedAlternatives) {
		if (rejected.exhausted) continue;
		if (!recordBlockers(rejected, byRelation, endpoints, relations)) return false;
		concrete = true;
	}
	if (!concrete) return false;
	return { accepted: false, endpointIds: [...endpoints], relationIds: [...relations] };
}
