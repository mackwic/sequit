/// <reference types="node" />
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// macOS 27 denies other apps access to ~/Library/Application Support/Firefox, which the
// bundled Firefox still reads despite its temporary profile. Give it its own home until
// Playwright ships Firefox 158 (https://github.com/microsoft/playwright/issues/42768).
function firefoxLaunchOptions() {
	if (process.platform !== 'darwin') return {};
	const home = join(tmpdir(), 'sequit-playwright-firefox-home');
	mkdirSync(home, { recursive: true });
	return { env: { ...process.env, CFFIXED_USER_HOME: home } };
}

export default defineConfig({
	testDir: '../tests/app',
	testMatch: '**/e2e/**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		baseURL: 'http://127.0.0.1:4174',
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
		// Scenarios read the French interface; a dedicated scenario covers English.
		locale: 'fr-FR',
	},
	projects: [
		{ name: 'chromium', testIgnore: '**/mobile-reading.spec.ts' },
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'], launchOptions: firefoxLaunchOptions() },
			testMatch: [
				'**/shared-editor.spec.ts',
				'**/canvas-live-projection.spec.ts',
				'**/canvas-interactions.spec.ts',
				'**/nested-region-layout.spec.ts',
				'**/nested-region-depth-three.spec.ts',
				'**/grid-cell-layout.spec.ts',
			],
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
			testMatch: [
				'**/shared-editor.spec.ts',
				'**/canvas-live-projection.spec.ts',
				'**/canvas-interactions.spec.ts',
				'**/nested-region-layout.spec.ts',
				'**/nested-region-depth-three.spec.ts',
				'**/grid-cell-layout.spec.ts',
			],
		},
		{
			name: 'mobile-reading',
			use: { ...devices['iPhone 13'] },
			testMatch: '**/mobile-reading.spec.ts',
		},
	],
	webServer: [
		{
			command: 'pnpm run dev:collaboration --port 8788',
			cwd: '..',
			url: 'http://127.0.0.1:8788/health',
			reuseExistingServer: false,
			timeout: 120_000,
		},
		{
			command: 'pnpm run dev:e2e',
			cwd: '..',
			env: { COLLABORATION_PORT: '8788' },
			url: 'http://127.0.0.1:4174',
			reuseExistingServer: false,
			timeout: 120_000,
		},
	],
});
