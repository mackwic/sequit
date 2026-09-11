import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

let testTimeout = 5_000;
if (process.env['SEQUIT_PROPERTY_MODE'] === 'fuzz') testTimeout = 60_000;

// Stryker runners share a sandbox, but Vite's optimizer cache is not safe for concurrent writers.
const mutationWorker = process.env['STRYKER_MUTATOR_WORKER'];
let cacheDir: string | undefined;
if (mutationWorker !== undefined) cacheDir = `node_modules/.vite/stryker-${mutationWorker}`;

export default defineConfig({
	cacheDir,
	plugins: [svelte()],
	test: {
		testTimeout,
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/**/e2e/**', 'tests/**/performance/**', 'tests/workers/**'],
		coverage: {
			provider: 'istanbul',
			include: ['src/**/*.ts'],
			exclude: ['src/workers/**'],
			reportsDirectory: 'coverage/web',
			reporter: ['text', 'html', 'json-summary'],
			thresholds: {
				branches: 98,
				functions: 98,
				lines: 98,
				statements: 98,
			},
		},
	},
});
