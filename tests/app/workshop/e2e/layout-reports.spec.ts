import { expect, test } from '@playwright/test';

import { validLayoutReport } from '../../../lib/infrastructure/layout-report/layout-report-fixture';

test('replays pulled layout reports with their pointed zones', async ({ page }) => {
	const report = validLayoutReport();
	const failed = { ...report, layout: undefined, rendered: undefined };
	await page.route('**/atelier/reports/data', (route) =>
		route.fulfill({
			json: {
				files: [
					{
						path: '2026-10-01/older.json',
						content: {
							id: 'older',
							receivedAt: '2026-10-01T09:00:00.000Z',
							build: null,
							...report,
						},
					},
					{
						path: '2026-10-02/newer.json',
						content: {
							id: 'newer',
							receivedAt: '2026-10-02T09:00:00.000Z',
							build: null,
							...failed,
							failure: 'missing-node-measurement',
						},
					},
					{ path: '2026-10-02/broken.json' },
				],
			},
		}),
	);
	await page.goto('/atelier/reports');

	const reports = page.getByRole('navigation', { name: 'Signalements' }).getByRole('link');
	// The page loads the layout engine on demand: a cold development server compiles it first.
	await expect(reports).toHaveCount(2, { timeout: 20000 });
	await expect(reports.first()).toHaveAttribute('aria-current', 'true');
	await expect(page.locator('[data-unreadable-reports]')).toContainText('2026-10-02/broken.json');
	// The fixture's measurements cover one box only: the engine fails as the report showed.
	await expect(page.locator('[data-replay]')).toHaveAttribute('data-replay', 'true');
	await expect(page.locator('[data-replay]')).toContainText('missing-node-measurement');
	await expect(page.locator('[data-replay-causes]')).toContainText('Missing node measurement');

	await reports.last().click();
	await expect(page).toHaveURL(/#older$/);
	await expect(page.getByRole('blockquote')).toHaveText(report.comment);
	await expect(page.locator('[data-replay]')).toHaveAttribute('data-replay', 'false');
	const canvas = page.getByRole('img', { name: 'Géométrie du signalement' });
	await expect(canvas.locator('[data-layer="zones"] rect')).toHaveCount(1);
	await expect(canvas.locator('.pointed')).toHaveCount(1);
	await page.getByRole('checkbox', { name: 'Dessiné à l’écran' }).check();
	await expect(canvas.locator('[data-layer="rendered"] path')).toHaveCount(1);
	await expect(page.getByRole('checkbox', { name: 'Rejoué ici' })).toBeDisabled();
	await expect(canvas.locator('[data-layer="visible"]')).toHaveCount(1);

	await page.getByRole('checkbox', { name: 'Layout précédent' }).check();
	await expect(canvas.locator('[data-layer="previous"] rect')).toHaveCount(2);
	await expect(page.locator('[data-previous-differences]')).toContainText(
		'boîte e10 : changement de position ou de taille',
	);

	const folding = page.locator('[data-report-groups]').getByRole('checkbox').first();
	await expect(folding).not.toBeChecked();
	await folding.check();
	await expect(page.locator('[data-replay-variant]')).toBeVisible();
});
