import { expect, test } from '@playwright/test';

test('compares the real adjacent bridge with an independently validated compact bridge candidate', async ({
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
		'Compare le détour sans croisement au candidat compact du graphe de canaux ; chaque pont admis est validé par l’oracle commun',
	);
	await expect(dedicated).toContainText('Ordre cible : d < e');
	await expect(independent).toContainText('Ordre cible : e < d');
	await expect(independent).toContainText('Contrat indépendant · pont retenu');
	const costs = comparison.getByRole('region', {
		name: 'Coûts comparés par le contrat adjacent',
	});
	await expect(costs).toContainText('Arbitrage du contrat : bridge');
	await expect(costs).toContainText('Tolérances de surcoût : aire +25 %, longueur +20 %.');
	await expect(costs).toContainText('Aire du détour');
	await expect(costs).toContainText('Routes du détour');
	await expect(costs).toContainText('Aire du pont');
	await expect(costs).toContainText('Routes du pont');
	await expect(costs).toContainText('191296 px²');
	await expect(costs).toContainText('1236 px');
	await expect(costs).toContainText('120768 px²');
	await expect(costs).toContainText('732 px');
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
	const arcCount = (paths: readonly string[]) =>
		paths.reduce((count, path) => count + (path.match(/\bA 6 6 /g)?.length ?? 0), 0);
	expect(arcCount(dedicatedPaths)).toBe(2);
	expect(arcCount(independentPaths)).toBe(2);
	await expect(dedicated).toContainText('Croisements stricts');
	await expect(dedicated).toContainText('Ponts rendus');
	await expect(independent).toContainText('Croisements stricts');
	const twoByTwo = comparison.locator('[data-adjacent-panel="two-by-two"]');
	await expect(twoByTwo).toContainText('2+2, bridge retenu');
	await expect(twoByTwo).toContainText('96 × 400 px');
	await expect(twoByTwo).toContainText('Croissance allouée du détour');
	await expect(twoByTwo).toContainText('523136 px²');
	await expect(twoByTwo).toContainText('429440 px²');
	await expect(twoByTwo).toContainText('1032 px');
	await expect(twoByTwo).toContainText('600 px');
	const twoByTwoPaths = await twoByTwo
		.locator('[data-rendered-relation-id]')
		.evaluateAll((paths) => paths.map((path) => path.getAttribute('d') ?? ''));
	expect(arcCount(twoByTwoPaths)).toBe(1);
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await dedicated.screenshot({
			path: `${screenshotDirectory}/adjacent-dedicated-bridge-before.png`,
		});
		await independent.screenshot({
			path: `${screenshotDirectory}/adjacent-independent-bridge-after.png`,
		});
	}
});
