import { expect, test } from '@playwright/test';

test('the workshop renders a validated independent adjacent layout and reports search limits', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Ordres × conflits × ports' }).click();
	const witness = page.getByRole('region', {
		name: 'Géométrie indépendante du contrat adjacent',
	});
	await expect(witness).toContainText('Les ordres inversés de ce corridor sont évalués');
	await expect(witness).toContainText('les routes à croisement strict sont rejetées');
	await expect(witness).toContainText('Les autres motifs et passages restent inconnus');
	await expect(witness).toContainText('candidats inversés exclus par la politique : 0');
	await expect(witness).toContainText('statut global undetermined');
	await expect(witness).toContainText('Candidat retenu dans cette tranche');
	await expect(witness.locator('[data-box-id]')).toHaveCount(5);
	await expect(witness.getByRole('img', { name: 'Géométrie du scénario' })).toBeVisible();
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await page.screenshot({
			path: `${screenshotDirectory}/independent-adjacent-contract.png`,
			fullPage: true,
		});
	}
	await page.getByRole('spinbutton', { name: 'Budget de branches' }).fill('0');
	await expect(witness).toContainText('La recherche est incomplète');
	await expect(witness.locator('[data-box-id]')).toHaveCount(0);
});
