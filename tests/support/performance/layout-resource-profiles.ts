import { performance } from 'node:perf_hooks';

import { median, percentile } from './performance-statistics';

export interface ResourceProfileSample {
	readonly status: string;
	/** Witness counters, or actual successful geometry-validator passes/comparisons. */
	readonly work: Readonly<Record<string, number>>;
}

export interface ResourceProfile {
	readonly name: string;
	readonly mode: 'cold' | 'incremental' | 'normalization-only';
	readonly status: string;
	readonly elapsedMs: { readonly median: number; readonly p95: number };
	readonly work: Readonly<Record<string, number>>;
	readonly heapDeltaBytes: { readonly median: number; readonly p95: number };
}

/** Input construction is intentionally outside the timed region; warmups are discarded. */
export function profileResource(
	name: string,
	mode: ResourceProfile['mode'],
	run: () => ResourceProfileSample,
	warmups = 2,
	samples = 7,
	beforeSample?: () => void,
): ResourceProfile {
	const times: number[] = [];
	const heapDeltas: number[] = [];
	let last: ResourceProfileSample | undefined;
	for (let index = -warmups; index < samples; index += 1) {
		beforeSample?.();
		const heapBefore = process.memoryUsage().heapUsed;
		const start = performance.now();
		const result = run();
		const elapsed = performance.now() - start;
		const heapDelta = process.memoryUsage().heapUsed - heapBefore;
		if (index < 0) continue;
		if (last !== undefined && (result.status !== last.status || !sameWork(result.work, last.work)))
			throw new Error(`Non-deterministic witness in ${name}/${mode}`);
		last = result;
		times.push(elapsed);
		heapDeltas.push(heapDelta);
	}
	if (last === undefined) throw new Error('At least one sample is required');
	return {
		name,
		mode,
		status: last.status,
		elapsedMs: { median: median(times), p95: percentile(times, 95) },
		work: last.work,
		// Heap deltas are noisy retained-heap observations, NOT allocation or peak-heap counts.
		heapDeltaBytes: { median: median(heapDeltas), p95: percentile(heapDeltas, 95) },
	};
}

function sameWork(
	left: ResourceProfileSample['work'],
	right: ResourceProfileSample['work'],
): boolean {
	const keys = Object.keys(left);
	return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

export function printResourceProfiles(profiles: readonly ResourceProfile[]): void {
	for (const { name, mode, status, elapsedMs, work, heapDeltaBytes } of profiles) {
		process.stdout.write(
			`\nRESOURCE_PROFILE ${JSON.stringify({ name, mode, status, p50Ms: Number(elapsedMs.median.toFixed(3)), p95Ms: Number(elapsedMs.p95.toFixed(3)), work, heapDeltaBytes })}\n`,
		);
	}
}
