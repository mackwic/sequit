import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/performance/**/*.test.ts'],
		exclude: [],
		fileParallelism: false,
		disableConsoleIntercept: true,
		coverage: {
			enabled: false,
		},
		benchmark: {
			include: ['tests/performance/**/*.bench.ts'],
		},
	},
});
