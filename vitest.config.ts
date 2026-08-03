import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.ts'],
			exclude: ['**/*.d.ts'],
			reportsDirectory: 'coverage/web',
			reporter: ['text', 'json-summary'],
			thresholds: {
				branches: 80,
				functions: 99,
				lines: 98,
				statements: 94,
			},
		},
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		exclude: ['tests/e2e/**'],
	},
});
