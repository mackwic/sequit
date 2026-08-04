import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './workers/collaboration/wrangler.jsonc' },
		}),
	],
	test: {
		include: ['workers/collaboration/test/**/*.test.ts'],
		coverage: {
			provider: 'istanbul',
			include: ['workers/collaboration/src/**/*.ts'],
			reportsDirectory: 'coverage/collaboration',
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
