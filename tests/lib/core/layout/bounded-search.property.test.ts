import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	bestWithinBudget,
	bestWithinBudgetStream,
	boundedCounter,
	type BoundedSearchResult,
	firstValidDepthFirst,
	type FirstValidSearchResult,
	scopedCounter,
	type SearchBudgetCounter,
	type SearchBudgetEvidence,
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

	it('keeps the historical baseline when a lazy stream is cut after it', () => {
		const evaluated: string[] = [];
		function* alternatives() {
			yield { id: 'canonical', score: 9 };
			yield { id: 'shorter', score: 5 };
			yield { id: 'best', score: 1 };
		}
		const result = bestWithinBudgetStream({
			alternatives: alternatives(),
			budget: 1,
			total: '3',
			evaluate: (candidate) => {
				evaluated.push(candidate.id);
				return candidate;
			},
			better: (candidate, incumbent) => candidate.score < incumbent.score,
		});
		expect(evaluated).toEqual(['canonical']);
		expect(result).toEqual({
			attempted: 1,
			total: '3',
			exhaustive: false,
			truncated: true,
			incumbent: { id: 'canonical', score: 9 },
		});
	});

	it('keeps the exact best valid stream candidate and the first candidate on ties', () => {
		function* alternatives() {
			yield { id: 'canonical', score: 9 };
			yield { id: 'shorter', score: 5 };
			yield { id: 'same-score', score: 5 };
		}
		const result = bestWithinBudgetStream({
			alternatives: alternatives(),
			budget: 3,
			total: '3',
			evaluate: (candidate) => candidate,
			better: (candidate, incumbent) => candidate.score < incumbent.score,
		});
		expect(result).toEqual({
			attempted: 3,
			total: '3',
			exhaustive: true,
			truncated: false,
			incumbent: { id: 'shorter', score: 5 },
		});
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

interface Problem {
	readonly levels: readonly (readonly number[])[];
	readonly budget: number;
}

const levelCase = fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 0, maxLength: 3 });
const problemCase = fc.record({
	levels: fc.array(levelCase, { minLength: 0, maxLength: 3 }),
	budget: fc.nat(40),
});

function choicesOf(problem: Problem, level: number): readonly number[] {
	return problem.levels[level] ?? [];
}

/** Declared acceptance: a value dividing its level is rejected, and no value repeats across levels. */
function accepted(level: number, choice: number, prefix: readonly number[]): boolean {
	if (choice % (level + 2) === 0) return false;
	return !prefix.includes(choice);
}

interface Attempts {
	readonly examined: number[];
	readonly rejected: number[];
	readonly reported: number[];
	readonly accepted: number[];
}

interface AttemptLog {
	readonly attempts: Attempts;
	readonly result: FirstValidSearchResult<number>;
}

function run(problem: Problem, counter: SearchBudgetCounter): AttemptLog {
	const attempts: Attempts = { examined: [], rejected: [], reported: [], accepted: [] };
	const result = firstValidDepthFirst<number, string>({
		levels: problem.levels.length,
		counter,
		choices: (level) => choicesOf(problem, level),
		accept: (level, choice, prefix) => {
			attempts.examined.push(choice);
			if (accepted(level, choice, prefix)) {
				attempts.accepted.push(choice);
				return undefined;
			}
			attempts.rejected.push(choice);
			return `rejected ${choice}`;
		},
		onReject: (_level, choice) => {
			attempts.reported.push(choice);
		},
	});
	return { attempts, result };
}

/** Every choice node of the declared tree: a budget this large is never refused. */
function examinationBound(problem: Problem): number {
	let bound = 1;
	let prefixes = 1;
	for (const choices of problem.levels) {
		prefixes *= choices.length;
		bound += prefixes;
	}
	return bound;
}

/** Every full selection in declared order, each accepted on its own prefix. */
function allSelections(problem: Problem): readonly (readonly number[])[] {
	let selections: number[][] = [[]];
	for (let level = 0; level < problem.levels.length; level += 1) {
		const next: number[][] = [];
		for (const prefix of selections)
			for (const choice of choicesOf(problem, level)) next.push([...prefix, choice]);
		selections = next;
	}
	return selections;
}

function isAccepted(selection: readonly number[]): boolean {
	const prefix: number[] = [];
	for (let level = 0; level < selection.length; level += 1) {
		const choice = selection[level];
		if (choice === undefined || !accepted(level, choice, prefix)) return false;
		prefix.push(choice);
	}
	return true;
}

function firstAcceptedSelection(problem: Problem): readonly number[] | undefined {
	for (const selection of allSelections(problem)) if (isAccepted(selection)) return selection;
	return undefined;
}

describe('bounded first-valid search', () => {
	it('returns the first accepted selection in declared order when the budget suffices', () => {
		fc.assert(
			fc.property(problemCase, (problem) => {
				const counter = boundedCounter(examinationBound(problem));
				const { result } = run(problem, counter);
				expect(result.selected).toEqual(firstAcceptedSelection(problem));
				expect(result.exhaustive).toBe(true);
				expect(counter.exhausted).toBe(false);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('stops non-exhaustively at a refused reservation, after spending its whole budget', () => {
		fc.assert(
			fc.property(problemCase, (problem) => {
				const counter = boundedCounter(problem.budget);
				const { attempts, result } = run(problem, counter);
				expect(result.exhaustive).toBe(!counter.exhausted);
				expect(attempts.examined).toHaveLength(counter.attempted);
				if (!counter.exhausted) return;
				expect(counter.attempted).toBe(problem.budget);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('reports every rejected choice to the reject hook and keeps the rest of the prefix', () => {
		fc.assert(
			fc.property(problemCase, (problem) => {
				const counter = boundedCounter(problem.budget);
				const { attempts } = run(problem, counter);
				expect(attempts.reported).toEqual(attempts.rejected);
				expect(attempts.rejected.length + attempts.accepted.length).toBe(attempts.examined.length);
				expect(counter.attempted).toBe(attempts.examined.length);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('examines nothing with a zero budget', () => {
		fc.assert(
			fc.property(problemCase, (problem) => {
				const counter = boundedCounter(0);
				const { attempts, result } = run(problem, counter);
				expect(attempts.examined).toEqual([]);
				expect(counter.attempted).toBe(0);
				if (problem.levels.length === 0) return;
				expect(result.selected).toBeUndefined();
			}),
			PROPERTY_PARAMETERS,
		);
	});
});

describe('scoped budget counters', () => {
	it('refuses at a scoped cap without spending the wider budget', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 8 }),
				fc.integer({ min: 1, max: 8 }),
				(scopedLimit, globalLimit) => {
					const global = boundedCounter(globalLimit);
					const phase = scopedCounter(global, scopedLimit);
					let taken = 0;
					while (phase.take()) taken += 1;
					const capped = scopedLimit <= globalLimit;
					expect(taken).toBe(Math.min(scopedLimit, globalLimit));
					expect(phase.attempted).toBe(taken);
					expect(phase.exhausted).toBe(capped);
					expect(global.attempted).toBe(taken);
					expect(global.exhausted).toBe(!capped);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('restarts a scoped phase by resetting its evidence, without restoring the wider budget', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 5 }), (phaseLimit) => {
				const global = boundedCounter(phaseLimit * 2);
				const evidence: SearchBudgetEvidence = { attempted: 0, exhausted: false };
				const phase = scopedCounter(global, phaseLimit, evidence);
				let first = 0;
				while (phase.take()) first += 1;
				evidence.attempted = 0;
				evidence.exhausted = false;
				let second = 0;
				while (phase.take()) second += 1;
				expect(first).toBe(phaseLimit);
				expect(second).toBe(phaseLimit);
				expect(phase.attempted).toBe(phaseLimit);
				expect(phase.exhausted).toBe(true);
				expect(global.attempted).toBe(phaseLimit * 2);
				expect(global.exhausted).toBe(false);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
