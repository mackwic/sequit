import { describe, expect, it } from 'vitest';

import { maximum, median, percentile } from './performance-statistics';

describe('performance statistics', () => {
	it('calculates odd and conventional even-sample medians', () => {
		expect(median([7, 1, 4])).toBe(4);
		expect(median([7, 1, 5, 3])).toBe(4);
	});

	it('selects percentile values using the nearest-rank rule', () => {
		expect(percentile([42], 95)).toBe(42);
		expect(
			percentile(
				Array.from({ length: 20 }, (_, index) => index + 1),
				95,
			),
		).toBe(19);
		expect(
			percentile(
				Array.from({ length: 100 }, (_, index) => index + 1),
				95,
			),
		).toBe(95);
		expect(percentile([3, 1, 2], 0)).toBe(1);
		expect(percentile([3, 1, 2], 100)).toBe(3);
	});

	it('finds the maximum without changing the caller array', () => {
		const values = [9, 2, 5, 1];
		expect(maximum(values)).toBe(9);
		expect(values).toEqual([9, 2, 5, 1]);
	});

	it('does not mutate samples while calculating ordered statistics', () => {
		const values = [8, 1, 4, 2];
		median(values);
		percentile(values, 95);
		expect(values).toEqual([8, 1, 4, 2]);
	});

	it('rejects empty samples and invalid percentile boundaries', () => {
		for (const statistic of [
			median,
			maximum,
			(values: readonly number[]) => percentile(values, 95),
		]) {
			expect(() => statistic([])).toThrow('empty sample');
		}
		expect(() => percentile([1], -1)).toThrow('between 0 and 100');
		expect(() => percentile([1], 101)).toThrow('between 0 and 100');
		expect(() => percentile([1], Number.NaN)).toThrow('between 0 and 100');
	});
});
