import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	bestWithinBudget,
	type BoundedSearchResult,
	validatedSearchBudget,
} from '../../../../src/lib/core/layout/bounded-search';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

interface Alternative {
	readonly id: number;
	readonly score: number;
}

interface Evaluation {
	readonly id: number;
	readonly accepted: boolean;
}

interface Selection {
	readonly id: number;
	readonly score: number;
}

/** Odd scores are accepted, even scores are rejected. */
function evaluate(alternative: Alternative): { evaluation: Evaluation; selection?: Selection } {
	if (alternative.score % 2 === 0) return { evaluation: { id: alternative.id, accepted: false } };
	return {
		evaluation: { id: alternative.id, accepted: true },
		selection: { id: alternative.id, score: alternative.score },
	};
}

/** Strictly better on score only: equal scores keep the earliest incumbent. */
function better(candidate: Selection, incumbent: Selection): boolean {
	return candidate.score < incumbent.score;
}

function search(
	alternatives: readonly Alternative[],
	budget: number,
): BoundedSearchResult<Evaluation, Selection> {
	return bestWithinBudget({ alternatives, budget, evaluate, better });
}

/** The `better` maximum of the accepted prefix, earliest on ties. */
function expectedIncumbent(
	alternatives: readonly Alternative[],
	budget: number,
): Selection | undefined {
	let best: Alternative | undefined;
	for (const alternative of alternatives.slice(0, budget)) {
		if (alternative.score % 2 === 0) continue;
		if (best === undefined || alternative.score < best.score) best = alternative;
	}
	if (best === undefined) return undefined;
	return { id: best.id, score: best.score };
}

const alternativeCase = fc
	.array(fc.integer({ min: -20, max: 20 }), { maxLength: 12 })
	.map((scores) => scores.map((score, id): Alternative => ({ id, score })));

const alternativeAndBudget = fc.tuple(alternativeCase, fc.nat(16));

describe('bounded best search', () => {
	it('explores exactly the declared prefix and reports exhaustiveness', () => {
		fc.assert(
			fc.property(alternativeAndBudget, ([alternatives, budget]) => {
				const result = search(alternatives, budget);
				expect(result.total).toBe(alternatives.length);
				expect(result.explored).toBe(Math.min(budget, alternatives.length));
				expect(result.evaluations).toHaveLength(result.explored);
				expect(result.exhaustive).toBe(budget >= alternatives.length);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('evaluates the prefix once each, in declared order', () => {
		fc.assert(
			fc.property(alternativeAndBudget, ([alternatives, budget]) => {
				const visited: number[] = [];
				bestWithinBudget({
					alternatives,
					budget,
					evaluate: (alternative) => {
						visited.push(alternative.id);
						return evaluate(alternative);
					},
					better,
				});
				const expected = alternatives.slice(0, budget).map(({ id }) => id);
				expect(visited).toEqual(expected);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps the better maximum of the accepted prefix', () => {
		fc.assert(
			fc.property(alternativeAndBudget, ([alternatives, budget]) => {
				const result = search(alternatives, budget);
				expect(result.incumbent).toEqual(expectedIncumbent(alternatives, budget));
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('reports the typed evaluation of every explored alternative', () => {
		fc.assert(
			fc.property(alternativeAndBudget, ([alternatives, budget]) => {
				const result = search(alternatives, budget);
				expect(result.evaluations).toEqual(
					alternatives
						.slice(0, budget)
						.map(({ id, score }): Evaluation => ({ id, accepted: score % 2 !== 0 })),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('explores nothing with a zero budget', () => {
		fc.assert(
			fc.property(alternativeCase, (alternatives) => {
				const result = search(alternatives, 0);
				expect(result.evaluations).toEqual([]);
				expect(result.explored).toBe(0);
				expect(result.incumbent).toBeUndefined();
				expect(result.exhaustive).toBe(alternatives.length === 0);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps the earliest accepted selection on ties', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 10 }), (count) => {
				const alternatives = Array.from({ length: count }, (_, id): Alternative => ({
					id,
					score: 7,
				}));
				const result = search(alternatives, count);
				expect(result.incumbent).toEqual({ id: 0, score: 7 });
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('accepts non-negative safe integers as budgets', () => {
		fc.assert(
			fc.property(fc.nat(2 ** 31), (budget) => {
				expect(validatedSearchBudget(budget)).toBe(budget);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('rejects any other budget', () => {
		for (const budget of [
			-1,
			Number.NaN,
			Number.MAX_SAFE_INTEGER + 1,
			0.5,
			Number.POSITIVE_INFINITY,
		])
			expect(() => validatedSearchBudget(budget)).toThrow(
				'Layout contract budget must be a non-negative safe integer',
			);
	});
});
