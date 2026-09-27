import {
	boundedCounter,
	scopedCounter,
	type SearchBudgetCounter,
} from '../../search/bounded-search';
import type { RegionPortalSide } from '../model/region-composition-types';
import type {
	RegionIncidentContract,
	RegionIncidentRejectedAlternative,
	RegionIncidentSearchWitness,
} from '../model/region-incident-contract';
import type { RegionLeafIncidentGeometryFailure } from './region-leaf-incident-geometry';

// A four-link chain selects after 4,130 checked alternatives across side assignments; 8,192
// leaves nearly twice that measured work while retaining the side cap and existing fallbacks.
const MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT = 1_024;
const MAX_ALTERNATIVES = 8_192;
const MAX_SLOT_WORK = 1_024;

/** A limit is spent only after checking a route, an endpoint/side, or a slot-building operation. */
export function exhaustedBudgetReason(state: SearchState): string {
	if (state.slotBudgetExceeded)
		return `The dedicated-leaf side-assignment construction exhausted its ${MAX_SLOT_WORK} slot-operation budget after ${state.slotWork} operations and ${state.attempted} route attempts.`;
	if (state.budgetExceeded)
		return `The dedicated-leaf global search exhausted its ${MAX_ALTERNATIVES} checked-alternative budget after ${state.attempted} attempts.`;
	return `The dedicated-leaf side-assignment search exhausted its ${MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT} checked-alternative budget after ${state.attempted} attempts.`;
}

export interface SearchState {
	attempted: number;
	assignmentAttempts: number;
	assignmentLimitReached: boolean;
	budgetExceeded: boolean;
	incomplete: boolean;
	slotWork: number;
	slotBudgetExceeded: boolean;
	readonly rejected: RegionIncidentRejectedAlternative[];
	/** Endpoint checks precede side assignments and charge only the global counter. */
	readonly globalBudget: SearchBudgetCounter;
	/** The alternative budget: the per-assignment cap composed under the global cap. */
	readonly budget: SearchBudgetCounter;
	/** Group insertions and slot writes, charged before each operation. */
	readonly slotBudget: SearchBudgetCounter;
}

/**
 * The leaf's budget composes a per-assignment cap under the global cap over the state's own witness
 * fields, so a new side assignment restarts the scoped count and a capped assignment leaves the
 * search incomplete even when a later one succeeds.
 */
export function newSearchState(): SearchState {
	const globalBudget = boundedCounter(MAX_ALTERNATIVES, {
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
	});
	const slotBudget = boundedCounter(MAX_SLOT_WORK, {
		get attempted(): number {
			return state.slotWork;
		},
		set attempted(value: number) {
			state.slotWork = value;
		},
		get exhausted(): boolean {
			return state.slotBudgetExceeded;
		},
		set exhausted(value: boolean) {
			state.slotBudgetExceeded = value;
		},
	});
	const state: SearchState = {
		attempted: 0,
		assignmentAttempts: 0,
		assignmentLimitReached: false,
		budgetExceeded: false,
		incomplete: false,
		rejected: [],
		slotWork: 0,
		slotBudgetExceeded: false,
		slotBudget,
		globalBudget,
		budget: scopedCounter(globalBudget, MAX_ALTERNATIVES_PER_SIDE_ASSIGNMENT, {
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
		}),
	};
	return state;
}

export function witness(state: SearchState, exhaustive: boolean): RegionIncidentSearchWitness {
	return {
		attempted: state.attempted,
		exhaustive,
		rejectedAlternatives: [...state.rejected],
		slotWork: {
			attempted: state.slotWork,
			limit: MAX_SLOT_WORK,
			exhausted: state.slotBudgetExceeded,
		},
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
