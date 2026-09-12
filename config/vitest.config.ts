import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

let testTimeout = 5_000;
if (process.env['SEQUIT_PROPERTY_MODE'] === 'fuzz') testTimeout = 60_000;

export default defineConfig({
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
				branches: 98,
				functions: 98,
				lines: 98,
				statements: 98,
			},
		},
	},
});
