import { describe, expect, it } from 'vitest';

import {
	bestWithinBudget,
	bestWithinBudgetStream,
	boundedCounter,
	firstValidDepthFirst,
	scopedCounter,
	validatedSearchBudget,
} from '../../../../src/lib/core/layout/search/bounded-search';

describe('bounded layout search examples', () => {
	it('keeps the best accepted candidate in the declared prefix and preserves the first tie', () => {
		const result = bestWithinBudget({
			alternatives: [
				{ id: 'first', score: 8 },
				{ id: 'rejected', score: 0 },
				{ id: 'tie', score: 8 },
				{ id: 'later', score: 1 },
			],
			budget: 3,
			evaluate: (alternative) => {
				if (alternative.id === 'rejected') return { evaluation: alternative.id };
				return { evaluation: alternative.id, selection: alternative };
			},
			better: (candidate, incumbent) => candidate.score < incumbent.score,
		});

		expect(result).toEqual({
			evaluations: ['first', 'rejected', 'tie'],
			explored: 3,
			total: 4,
			exhaustive: false,
			incumbent: { id: 'first', score: 8 },
		});
	});

	it('reports a complete search without an incumbent when every route candidate is rejected', () => {
		const result = bestWithinBudget({
			alternatives: ['blocked-a', 'blocked-b'],
			budget: 2,
			evaluate: (evaluation) => ({ evaluation }),
			better: () => false,
		});

		expect(result).toEqual({
			evaluations: ['blocked-a', 'blocked-b'],
			explored: 2,
			total: 2,
			exhaustive: true,
		});
		expect(result).not.toHaveProperty('incumbent');
	});

	it('stops a lazy product at its work budget without evaluating the next candidate', () => {
		const visited: number[] = [];
		function* candidates() {
			for (const value of [9, 4, 1]) yield value;
		}

		const result = bestWithinBudgetStream({
			alternatives: candidates(),
			budget: 2,
			total: '100000000000000000000',
			evaluate: (candidate) => {
				visited.push(candidate);
				if (candidate === 9) return undefined;
				return candidate;
			},
			better: (candidate, incumbent) => candidate < incumbent,
		});

		expect(result).toEqual({
			attempted: 2,
			total: '100000000000000000000',
			exhaustive: false,
			truncated: true,
			incumbent: 4,
		});
		expect(visited).toEqual([9, 4]);
	});

	it('replaces a streamed incumbent while retaining the first best tie', () => {
		const visited: number[] = [];
		const result = bestWithinBudgetStream({
			alternatives: [9, 4, 4],
			budget: 3,
			total: '3',
			evaluate: (candidate) => {
				visited.push(candidate);
				return candidate;
			},
			better: (candidate, incumbent) => candidate < incumbent,
		});

		expect(result).toEqual({
			attempted: 3,
			total: '3',
			exhaustive: true,
			truncated: false,
			incumbent: 4,
		});
		expect(visited).toEqual([9, 4, 4]);
	});

	it('returns complete stream evidence when every route candidate is rejected', () => {
		const visited: number[] = [];
		const result = bestWithinBudgetStream({
			alternatives: [2, 3],
			budget: 2,
			total: '2',
			evaluate: (candidate) => {
				visited.push(candidate);
				return undefined;
			},
			better: () => false,
		});

		expect(result).toEqual({ attempted: 2, total: '2', exhaustive: true, truncated: false });
		expect(result).not.toHaveProperty('incumbent');
		expect(visited).toEqual([2, 3]);
	});

	it('backtracks from an incomplete route prefix and selects the next complete branch', () => {
		const counter = boundedCounter(10);
		const rejected: string[] = [];
		const backtracked: string[] = [];
		const exhausted: string[][] = [];
		const result = firstValidDepthFirst<string, string>({
			levels: 2,
			counter,
			choices: (level, prefix) => {
				if (level === 0) return ['blocked', 'a', 'b'];
				if (prefix[0] === 'a') return ['dead-1', 'dead-2'];
				return ['route-b'];
			},
			accept: (level, _choice, prefix) => {
				if (level === 0 && prefix.length === 0 && _choice === 'blocked') return 'port unavailable';
				if (prefix[0] === 'a') return 'channel obstructed';
				return undefined;
			},
			onReject: (_level, choice, reason) => rejected.push(`${choice}:${reason}`),
			onBacktrack: (_level, choice) => backtracked.push(choice),
			onExhausted: (_level, prefix) => exhausted.push([...prefix]),
		});

		expect(result).toEqual({ selected: ['b', 'route-b'], exhaustive: true });
		expect(counter.attempted).toBe(6);
		expect(rejected).toEqual([
			'blocked:port unavailable',
			'dead-1:channel obstructed',
			'dead-2:channel obstructed',
		]);
		expect(backtracked).toEqual(['a']);
		expect(exhausted).toEqual([['a']]);
	});

	it('marks a first-valid search truncated when its next level cannot reserve work', () => {
		const onBacktrack: string[] = [];
		const result = firstValidDepthFirst<string, string>({
			levels: 2,
			counter: boundedCounter(1),
			choices: (level) => {
				if (level === 0) return ['source'];
				return ['target'];
			},
			accept: () => undefined,
			onReject: () => undefined,
			onBacktrack: (_level, choice) => onBacktrack.push(choice),
		});

		expect(result).toEqual({ exhaustive: false });
		expect(onBacktrack).toEqual([]);
	});

	it('keeps a phase cap local and exposes global exhaustion only from the parent', () => {
		const parentEvidence = { attempted: 0, exhausted: false };
		const parent = boundedCounter(1, parentEvidence);
		const firstPhase = scopedCounter(parent, 1);
		const secondPhaseEvidence = { attempted: 0, exhausted: false };
		const secondPhase = scopedCounter(parent, 2, secondPhaseEvidence);

		expect(firstPhase.take()).toBe(true);
		expect(firstPhase.take()).toBe(false);
		expect(firstPhase.attempted).toBe(1);
		expect(firstPhase.exhausted).toBe(true);
		expect(secondPhase.take()).toBe(false);
		expect(secondPhase.attempted).toBe(0);
		expect(secondPhase.exhausted).toBe(false);
		expect(parent.attempted).toBe(1);
		expect(parent.exhausted).toBe(true);
		expect(secondPhaseEvidence).toEqual({ attempted: 0, exhausted: false });
	});

	it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects an invalid declared work budget (%s)',
		(budget) => {
			expect(() => validatedSearchBudget(budget)).toThrow(Error);
		},
	);

	it('treats a zero budget as no candidate evaluations', () => {
		const evaluated: number[] = [];
		const result = bestWithinBudget({
			alternatives: [7],
			budget: 0,
			evaluate: (candidate) => {
				evaluated.push(candidate);
				return { evaluation: candidate, selection: candidate };
			},
			better: (candidate, incumbent) => candidate < incumbent,
		});

		expect(result).toEqual({ evaluations: [], explored: 0, total: 1, exhaustive: false });
		expect(evaluated).toEqual([]);
	});
});
