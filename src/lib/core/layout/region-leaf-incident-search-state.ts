import type { RegionLeafIncidentGeometryFailure } from './region-leaf-incident-geometry';
import type { RegionPortalSide } from './regions/model/region-composition-types';
import type {
	RegionIncidentContract,
	RegionIncidentRejectedAlternative,
	RegionIncidentSearchWitness,
} from './regions/model/region-incident-contract';
import { boundedCounter, scopedCounter, type SearchBudgetCounter } from './search/bounded-search';

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
