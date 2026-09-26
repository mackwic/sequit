import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface PerformanceMeasurement {
	readonly scenario: string;
	readonly size: number | string;
	readonly metric: string;
	readonly observedMs: number;
	readonly budgetMs: number;
	readonly details: unknown;
}

/** Optional machine-readable output; written after timing and also when a budget fails. */
export function recordPerformanceMeasurements(rows: readonly PerformanceMeasurement[]): void {
	const destination = process.env['SEQUIT_PERFORMANCE_MEASUREMENTS'];
	if (destination === undefined) return;
	let existing: unknown[] = [];
	if (existsSync(destination)) {
		const parsed: unknown = JSON.parse(readFileSync(destination, 'utf8'));
		if (!Array.isArray(parsed))
			throw new TypeError('Performance measurement output must be an array');
		existing = parsed;
	}
	writeFileSync(destination, JSON.stringify([...existing, ...rows], null, 2));
}
