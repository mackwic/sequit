import { writeFileSync } from 'node:fs';

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
	writeFileSync(destination, JSON.stringify(rows, null, 2));
}
