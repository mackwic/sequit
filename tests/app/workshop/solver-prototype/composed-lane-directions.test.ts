import { describe, expect, it } from 'vitest';

import {
	composedFixture,
	composedSettings,
} from '../../../../src/app/workshop/solver-prototype/composed-fixtures';
import {
	solveComposedSlice,
	validateComposedGeometry,
} from '../../../../src/app/workshop/solver-prototype/composed-slice';

const laneSets = [
	['A', 'B', 'C'],
	['S', 'SD', 'C'],
] as const;

describe.each(laneSets)('composed lanes %s | %s | %s', (...laneIds) => {
	it.each(['vertical', 'horizontal'] as const)(
		'validates every explored branch in %s orientation and both relation directions',
		(orientation) => {
			for (const direction of ['forward', 'reverse'] as const) {
				for (const kind of ['free', 'blocking'] as const) {
					const input = composedFixture(kind, orientation, {
						laneIds,
						direction,
					});
					const settings = composedSettings({ budget: 1_000 });
					const solution = solveComposedSlice(input, settings);
					const context = `${laneIds.join('|')} ${orientation} ${direction} ${kind}`;
					expect(solution.outcome, context).toBe('selected');
					expect(solution.truncated, context).toBe(false);
					expect(solution.candidates.length, context).toBeGreaterThan(0);
					expect(
						solution.candidates.some(({ status }) => status === 'selected'),
						context,
					).toBe(true);
					for (const candidate of solution.candidates) {
						const branch = `${context} ${candidate.id}`;
						if (candidate.status === 'selected' || candidate.status === 'feasible') {
							expect(candidate.geometry, branch).toBeDefined();
							if (candidate.geometry !== undefined)
								expect(
									validateComposedGeometry(input, candidate.geometry, settings),
									branch,
								).toBeUndefined();
							continue;
						}
						expect(candidate.status, branch).toBe('rejected');
						expect(candidate.reason?.length, branch).toBeGreaterThan(0);
						expect(candidate.rejectionPhase, branch).toMatch(/^(symbolic|geometry)$/);
						if (candidate.rejectionPhase === 'symbolic') {
							expect(candidate.geometry, branch).toBeUndefined();
						} else {
							expect(candidate.geometry, branch).toBeDefined();
							if (candidate.geometry !== undefined)
								expect(validateComposedGeometry(input, candidate.geometry, settings), branch).toBe(
									candidate.reason,
								);
						}
					}
					if (kind === 'blocking') {
						const interior = solution.candidates.filter(
							({ passageKind }) => passageKind !== 'exterior',
						);
						expect(interior.length, context).toBeGreaterThan(0);
						expect(
							interior.every(
								({ status, rejectionPhase }) =>
									status === 'rejected' && rejectionPhase === 'symbolic',
							),
							context,
						).toBe(true);
						expect(
							interior.some(({ reason }) => reason?.includes('groupe sd-work') === true),
							context,
						).toBe(true);
					}
				}
			}
		},
	);
});
