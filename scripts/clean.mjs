import { rm } from 'node:fs/promises';

const GENERATED_PATHS = [
	'.netlify',
	'.output',
	'.stryker-tmp',
	'.svelte-kit',
	'.vercel',
	'.wrangler',
	'build',
	'coverage',
	'dist',
	'playwright-report',
	'test-results',
	'src/workers/collaboration-worker/.wrangler',
	'src/app/web/i18n/paraglide',
];

await Promise.all(
	GENERATED_PATHS.map(async (path) => {
		await rm(path, { force: true, recursive: true });
	}),
);
