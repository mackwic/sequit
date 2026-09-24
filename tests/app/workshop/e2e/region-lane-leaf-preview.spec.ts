import { expect, test } from '@playwright/test';

test('the workshop renders two validated lane orientations inside a region leaf', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Lanes dans région' }).click();
	const witness = page.getByRole('region', { name: 'Deux lanes dans une feuille de région' });
	await expect(witness.getByTestId('region-lane-status')).toContainText(
		'Validé · 2 régions · 2 lanes · 1 route locale',
	);
	await expect(witness.getByTestId('region-shared')).toHaveCount(1);
	await expect(witness.getByTestId('region-ordinary')).toHaveCount(1);
	await expect(witness.getByTestId('lane-sales')).toHaveCount(1);
	await expect(witness.getByTestId('lane-service')).toHaveCount(1);
	await expect(witness.getByTestId('node-request')).toHaveCount(1);
	await expect(witness.getByTestId('node-delivery')).toHaveCount(1);
	await expect(witness.getByTestId('node-neighbor')).toHaveCount(1);
	await expect(witness.getByTestId('route-handoff')).toHaveCount(1);
	await expect(witness).toContainText('Demande : rang 1');
	await expect(witness).toContainText('Livraison : rang 0');
	await expect(witness).toContainText('Voisin : rang 0');
	const parallelRoute = await witness.getByTestId('route-handoff').getAttribute('points');
	await witness.getByRole('button', { name: 'Transverse' }).click();
	await expect(witness.getByTestId('region-lane-status')).toContainText('Validé · 2 régions');
	await expect(witness.getByRole('button', { name: 'Transverse' })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	const transverseRoute = await witness.getByTestId('route-handoff').getAttribute('points');
	expect(transverseRoute).not.toBe(parallelRoute);
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await page.screenshot({
			path: `${screenshotDirectory}/region-lane-leaf-transverse.png`,
			fullPage: true,
		});
	}
});
