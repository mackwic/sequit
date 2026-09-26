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
			include: [
				'src/**/*.ts',
				'tests/scenarios/visual/**/*.ts',
				'tests/support/assertions/**/*.ts',
				'tests/support/builders/visual-graph-builder.ts',
				'tests/support/fixtures/{graph-fixtures,routing-fixtures}.ts',
				'tests/support/harnesses/{box-geometry,layout-nodes,visual-layout,visual-directions}.ts',
			],
			exclude: ['src/workers/**', 'tests/**/*.test.ts'],
			reportsDirectory: 'coverage/web',
			reporter: ['text', 'html', 'json-summary'],
			thresholds: {
				branches: 90,
				functions: 90,
				lines: 90,
				statements: 90,
			},
		},
	},
});
