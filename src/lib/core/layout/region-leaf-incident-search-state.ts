import type { RegionPortalSide } from './region-composition-types';
import type {
	RegionIncidentContract,
	RegionIncidentRejectedAlternative,
	RegionIncidentSearchWitness,
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
}

export function newSearchState(): SearchState {
	return {
		attempted: 0,
		assignmentAttempts: 0,
		assignmentLimitReached: false,
		budgetExceeded: false,
		incomplete: false,
		rejected: [],
	};
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
		code: failure.code,
		reason: failure.reason,
	};
	if (failure.candidateId === undefined) state.rejected.push(alternative);
	else state.rejected.push({ ...alternative, candidateId: failure.candidateId });
}

export function takeAttempt(state: SearchState): boolean {
	if (state.attempted >= MAX_ALTERNATIVES) {
		state.budgetExceeded = true;
		return false;
	}
	if (state.assignmentAttempts >= MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT) {
		state.assignmentLimitReached = true;
		state.incomplete = true;
		return false;
	}
	state.attempted += 1;
	state.assignmentAttempts += 1;
	return true;
}
