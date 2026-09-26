import { describe, expect, it } from 'vitest';

import {
	bestWithinBudget,
	boundedCounter,
	firstValidDepthFirst,
	scopedCounter,
	validDepthFirst,
} from '../../../../src/lib/core/layout/search/bounded-search';

describe('bounded layout search examples', () => {
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
		expect(rejected).toEqual([
			'blocked:port unavailable',
			'dead-1:channel obstructed',
			'dead-2:channel obstructed',
		]);
		expect(backtracked).toEqual(['a']);
		expect(exhausted).toEqual([['a']]);
	});

	it('suspends accepted prefixes and resumes until a bounded refusal with rejection provenance', () => {
		const counter = boundedCounter(4);
		const rejected: string[] = [];
		const search = validDepthFirst({
			levels: 2,
			counter,
			choices: (level: number) => {
				if (level === 0) return ['a', 'b'];
				return ['blocked', 'one', 'two'];
			},
			accept: (_level, choice: string) => {
				if (choice === 'blocked') return 'obstructed';
				return undefined;
			},
			onReject: (_level, choice, reason) => rejected.push(`${choice}:${reason}`),
		});
		expect(search.next()).toEqual({ done: false, value: ['a', 'one'] });
		expect(counter.attempted).toBe(3);
		expect(rejected).toEqual(['blocked:obstructed']);
		expect(search.next()).toEqual({ done: false, value: ['a', 'two'] });
		expect(search.next()).toEqual({ done: true, value: false });
		expect(counter.attempted).toBe(4);
		expect(counter.exhausted).toBe(true);
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
});
