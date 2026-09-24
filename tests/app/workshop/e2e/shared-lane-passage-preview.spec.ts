import { expect, test } from '@playwright/test';

test('the workshop compares a valid exterior rail with the selected interior passage', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Passages S | SD | C' }).click();
	const comparison = page.getByRole('region', { name: 'Comparaison des passages S SD C' });
	await expect(comparison.getByTestId('passage-provenance')).toContainText(
		'Document workshop-s-sd-c-passage · 2 nœuds · 1 groupe vide · 1 relation',
	);
	const exterior = comparison.getByTestId('passage-panel-exterior');
	const interior = comparison.getByTestId('passage-panel-interior');
	await expect(exterior.getByTestId('passage-status')).toHaveText('Candidat admissible');
	await expect(interior.getByTestId('passage-status')).toHaveText('Sélectionné');
	await expect(exterior.getByTestId('passage-metrics')).toContainText('Géométrie validée');
	await expect(interior.getByTestId('passage-metrics')).toContainText('Géométrie validée');
	await expect(exterior.getByTestId('passage-metrics')).toContainText('Monotone : non');
	await expect(interior.getByTestId('passage-metrics')).toContainText('Monotone : oui');
	await expect(exterior.getByTestId('passage-metrics')).toContainText('Longueur :');
	await expect(interior.getByTestId('passage-metrics')).toContainText('Traversée SD : y =');
	const exteriorSvg = exterior.getByRole('img');
	const interiorSvg = interior.getByRole('img');
	const fullViewBox = await exteriorSvg.getAttribute('viewBox');
	expect(fullViewBox).toBe(await interiorSvg.getAttribute('viewBox'));
	expect(await exterior.getByTestId('passage-route-exterior').getAttribute('points')).not.toBe(
		await interior.getByTestId('passage-route-interior').getAttribute('points'),
	);
	const exteriorBox = await exteriorSvg.boundingBox();
	const interiorBox = await interiorSvg.boundingBox();
	expect(exteriorBox?.width).toBe(interiorBox?.width);
	expect(exteriorBox?.height).toBe(interiorBox?.height);
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await exterior.screenshot({
			path: `${screenshotDirectory}/shared-lane-exterior-before.png`,
		});
		await interior.screenshot({ path: `${screenshotDirectory}/shared-lane-interior-after.png` });
	}
	const zoom = comparison.getByTestId('passage-zoom');
	await zoom.click();
	await expect(zoom).toHaveAttribute('aria-pressed', 'true');
	const focusedViewBox = await exteriorSvg.getAttribute('viewBox');
	expect(focusedViewBox).not.toBe(fullViewBox);
	expect(focusedViewBox).toBe(await interiorSvg.getAttribute('viewBox'));
	await zoom.click();
	await expect(zoom).toHaveAttribute('aria-pressed', 'false');
	expect(await exteriorSvg.getAttribute('viewBox')).toBe(fullViewBox);
	expect(await interiorSvg.getAttribute('viewBox')).toBe(fullViewBox);
});
