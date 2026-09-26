import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
	type PerformanceMeasurement,
	recordPerformanceMeasurements,
} from './record-performance-measurements';

const previousDestination = process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'];

afterEach(() => {
	if (previousDestination === undefined) delete process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'];
	else process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'] = previousDestination;
});

describe('performance measurement output', () => {
	it('aggregates rows recorded by sequential performance files', () => {
		const directory = mkdtempSync(join(tmpdir(), 'sequit-performance-'));
		const destination = join(directory, 'measurements.json');
		const first: PerformanceMeasurement = {
			scenario: 'layout edit',
			size: 100,
			metric: 'medianMs',
			observedMs: 4,
			budgetMs: 10,
			details: { samples: [3, 4, 5] },
		};
		const second: PerformanceMeasurement = {
			scenario: 'collaborative edit',
			size: 3_200,
			metric: 'medianMs',
			observedMs: 8,
			budgetMs: 15,
			details: { samples: [7, 8, 9] },
		};
		process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'] = destination;
		try {
			recordPerformanceMeasurements([first]);
			recordPerformanceMeasurements([second]);
			expect(JSON.parse(readFileSync(destination, 'utf8'))).toEqual([first, second]);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
	it('refuses to overwrite a non-array report', () => {
		const directory = mkdtempSync(join(tmpdir(), 'sequit-performance-'));
		const destination = join(directory, 'measurements.json');
		process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'] = destination;
		try {
			writeFileSync(destination, '{}');
			expect(() => {
				recordPerformanceMeasurements([]);
			}).toThrow('Performance measurement output must be an array');
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
