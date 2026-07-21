import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		baseURL: 'http://127.0.0.1:4174',
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
	},
	webServer: {
		command: 'pnpm dev:e2e',
		url: 'http://127.0.0.1:4174',
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
