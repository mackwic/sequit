import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './workers/collaboration/wrangler.jsonc' },
		}),
	],
	test: {
		coverage: {
			provider: 'istanbul',
			include: ['workers/collaboration/src/**/*.ts'],
			exclude: ['**/*.d.ts'],
			reportsDirectory: 'coverage/collaboration',
			reporter: ['text', 'json-summary'],
			thresholds: {
				branches: 36,
				functions: 40,
				lines: 43,
				statements: 43,
			},
		},
		include: ['workers/collaboration/test/**/*.test.ts'],
	},
});
