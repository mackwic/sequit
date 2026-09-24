import { describe, expect, it } from 'vitest';

import {
	newSearchState,
	takeAttempt,
	witness,
} from '../../../../src/lib/core/layout/region-leaf-incident-search-state';

describe('bounded incident search evidence', () => {
	it('preserves a turn for another side and never calls a truncated search exhaustive', () => {
		const state = newSearchState();
		for (let attempt = 0; attempt < 1_024; attempt += 1) expect(takeAttempt(state)).toBe(true);
		expect(takeAttempt(state)).toBe(false);
		expect(state.assignmentLimitReached).toBe(true);
		expect(state.incomplete).toBe(true);
		expect(state.budgetExceeded).toBe(false);
		expect(witness(state, false)).toMatchObject({ attempted: 1_024, exhaustive: false });

		for (let assignment = 0; assignment < 7; assignment += 1) {
			state.assignmentAttempts = 0;
			state.assignmentLimitReached = false;
			for (let attempt = 0; attempt < 1_024; attempt += 1) expect(takeAttempt(state)).toBe(true);
		}
		state.assignmentAttempts = 0;
		expect(takeAttempt(state)).toBe(false);
		expect(state.budgetExceeded).toBe(true);
		expect(witness(state, false)).toMatchObject({ attempted: 8_192, exhaustive: false });
	});
});
