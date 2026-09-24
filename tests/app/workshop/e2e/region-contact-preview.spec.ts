import { expect, test } from '@playwright/test';

test('the workshop compares real boundary contacts with rejected alternatives', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Contacts de régions' }).click();

	const explorer = page.getByRole('region', { name: 'Contacts aux frontières de régions' });
	const parent = explorer.getByTestId('contact-case-parent-contact');
	await expect(parent).toContainText('Document parent-contact-witness · 6 nœuds · 3 relations');
	const parentValid = parent.getByTestId('contact-panel-parent-contact-validated');
	const parentShared = parent.getByTestId('contact-panel-parent-contact-shared-portal');
	await expect(parentValid.getByTestId('contact-status')).toHaveText('Validé');
	await expect(parentShared.getByTestId('contact-status')).toHaveText('Rejeté');
	await expect(parentShared.getByTestId('contact-validation')).toContainText(
		'intersect without a bridge',
	);
	await expect(parentValid.getByTestId('portal-inside-branch-branch-right')).toHaveCount(1);
	await expect(parentValid.getByTestId('portal-c-to-d-branch-right')).toHaveCount(1);
	await expect(parentValid.getByTestId('owned-c-to-d-branch')).toHaveCount(1);
	expect(await parentValid.locator('svg').getAttribute('viewBox')).toBe(
		await parentShared.locator('svg').getAttribute('viewBox'),
	);

	const grid = explorer.getByTestId('contact-case-grid-contact');
	await expect(grid).toContainText('Document grid-contact-witness · 6 nœuds · 2 relations');
	await expect(grid).toContainText('across-grid touche cette sortie sans pont');
	const gridValid = grid.getByTestId('contact-panel-grid-contact-validated');
	const gridDirect = grid.getByTestId('contact-panel-grid-contact-direct-exit');
	const gridCrossing = grid.getByTestId('contact-panel-grid-contact-strict-crossing');
	await expect(gridValid.getByTestId('contact-status')).toHaveText('Validé');
	await expect(gridDirect.getByTestId('contact-validation')).toContainText(
		'crosses foreign node a-source',
	);
	await expect(gridValid.getByTestId('owned-leaves-grid-a')).toHaveCount(1);
	await expect(gridValid.getByTestId('portal-leaves-grid-a')).toHaveCount(1);
	await expect(gridCrossing.getByTestId('contact-status')).toHaveText('Rejeté');
	await expect(gridCrossing.getByTestId('strict-crossing-probe')).toHaveCount(1);
	await expect(gridCrossing).toContainText('hypothèse');
	await expect(explorer).toContainText('aucun pont n’est validé ici');
	for (const candidate of [gridDirect, gridCrossing]) {
		expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(
			await candidate.locator('svg').getAttribute('viewBox'),
		);
	}

	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await explorer.screenshot({ path: `${screenshotDirectory}/region-contact-workshop.png` });
	}

	const parentFull = await parentValid.locator('svg').getAttribute('viewBox');
	const gridFull = await gridValid.locator('svg').getAttribute('viewBox');
	const parentZoom = parent.getByTestId('contact-zoom-parent-contact');
	const gridZoom = grid.getByTestId('contact-zoom-grid-contact');
	await parentZoom.click();
	await expect(parentZoom).toHaveAttribute('aria-pressed', 'true');
	const parentFocused = await parentValid.locator('svg').getAttribute('viewBox');
	expect(parentFocused).not.toBe(parentFull);
	expect(parentFocused).toBe(await parentShared.locator('svg').getAttribute('viewBox'));
	expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(gridFull);
	await gridZoom.click();
	await expect(gridZoom).toHaveAttribute('aria-pressed', 'true');
	const gridFocused = await gridValid.locator('svg').getAttribute('viewBox');
	expect(gridFocused).not.toBe(gridFull);
	for (const candidate of [gridDirect, gridCrossing]) {
		expect(await candidate.locator('svg').getAttribute('viewBox')).toBe(gridFocused);
	}
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await explorer.screenshot({
			path: `${screenshotDirectory}/region-contact-workshop-focused.png`,
		});
	}
	await parentZoom.click();
	await expect(parentZoom).toHaveAttribute('aria-pressed', 'false');
	expect(await parentValid.locator('svg').getAttribute('viewBox')).toBe(parentFull);
	await gridZoom.click();
	await expect(gridZoom).toHaveAttribute('aria-pressed', 'false');
	expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(gridFull);
});
