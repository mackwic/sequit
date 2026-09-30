import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './src/workers/collaboration-worker/wrangler.jsonc' },
		}),
	],
	test: {
		include: ['tests/workers/collaboration-worker/**/*.test.ts'],
		setupFiles: ['tests/workers/collaboration-worker/silence-journal.ts'],
		coverage: {
			provider: 'istanbul',
			include: ['src/workers/collaboration-worker/**/*.ts'],
			exclude: ['**/.wrangler/**', 'src/workers/collaboration-worker/vitest.config.ts'],
			reportsDirectory: 'coverage/collaboration',
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
