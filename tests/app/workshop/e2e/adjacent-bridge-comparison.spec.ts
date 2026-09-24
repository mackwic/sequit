import { expect, test } from '@playwright/test';

test('compares the real adjacent bridge with an independently validated detour on one frame', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Pont × détour adjacent' }).click();
	const comparison = page.getByRole('region', {
		name: 'Comparaison du pont et du détour adjacents',
	});
	await expect(comparison).toContainText('Document real-k32-witness');
	await expect(comparison).toContainText('globalStatus: undetermined');
	const dedicated = comparison.locator('[data-adjacent-panel="dedicated"]');
	const independent = comparison.locator('[data-adjacent-panel="independent"]');
	await expect(dedicated).toContainText(
		'Valide géométriquement selon la politique du moteur dédié',
	);
	await expect(independent).toContainText(
		'Admet les croisements portés par un pont validé puis arbitre détour et pont par les tolérances déclarées',
	);
	await expect(dedicated).toContainText('Ordre cible : d < e');
	await expect(independent).toContainText('Ordre cible : e < d');
	await expect(dedicated.locator('[data-box-id]')).toHaveCount(5);
	await expect(independent.locator('[data-box-id]')).toHaveCount(5);
	const dedicatedSvg = dedicated.getByRole('img', { name: 'Géométrie du scénario' });
	const independentSvg = independent.getByRole('img', { name: 'Géométrie du scénario' });
	await expect(dedicatedSvg).toHaveAttribute(
		'viewBox',
		(await independentSvg.getAttribute('viewBox')) ?? '',
	);
	const firstBox = await dedicatedSvg.boundingBox();
	const secondBox = await independentSvg.boundingBox();
	expect(firstBox).not.toBeNull();
	expect(secondBox).not.toBeNull();
	expect(firstBox?.width).toBe(secondBox?.width);
	expect(firstBox?.height).toBe(secondBox?.height);
	const dedicatedPaths = await dedicated
		.locator('[data-rendered-relation-id]')
		.evaluateAll((paths) => paths.map((path) => path.getAttribute('d') ?? ''));
	const independentPaths = await independent
		.locator('[data-rendered-relation-id]')
		.evaluateAll((paths) => paths.map((path) => path.getAttribute('d') ?? ''));
	expect(dedicatedPaths.some((path) => /\bA 6 6 /.test(path))).toBe(true);
	expect(independentPaths.some((path) => /\bA 6 6 /.test(path))).toBe(false);
	await expect(dedicated).toContainText('Croisements stricts');
	await expect(dedicated).toContainText('Ponts rendus');
	await expect(independent).toContainText('Croisements stricts');
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await dedicated.screenshot({
			path: `${screenshotDirectory}/adjacent-dedicated-bridge-before.png`,
		});
		await independent.screenshot({
			path: `${screenshotDirectory}/adjacent-independent-detour-after.png`,
		});
	}
});
