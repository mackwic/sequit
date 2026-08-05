import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/e2e/**', 'tests/performance/**'],
		coverage: {
			provider: 'istanbul',
			include: ['src/**/*.ts'],
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
