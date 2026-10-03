import { expect, test } from '@playwright/test';

test('« Signaler un problème de mise en page » sends an anonymized report with a pointed box', async ({
	page,
}) => {
	let sent: unknown;
	await page.route('**/layout-reports', async (route) => {
		sent = route.request().postDataJSON();
		await route.fulfill({ status: 201, json: { id: 'rapport-1' } });
	});
	await page.goto('/examples/ai-documentary-effort');
	const box = page.locator('[data-node-id="ai-generation-orchestration"]');
	await box.scrollIntoViewIfNeeded();

	const open = page.getByRole('button', { name: 'Signaler un problème de mise en page' });
	await open.click();
	const dialog = page.getByRole('dialog', { name: 'Signaler un problème de mise en page' });
	const send = dialog.getByRole('button', { name: /Envoyer/ });
	await expect(send).toBeDisabled();
	await dialog.getByRole('radio', { name: 'Croisement évitable' }).check();
	await dialog.getByRole('textbox', { name: 'Commentaire' }).fill('Deux flèches se croisent');

	await dialog.getByRole('button', { name: 'Pointer sur le graphe' }).click();
	await expect(dialog).toHaveCount(0);
	const bounds = await box.boundingBox();
	if (bounds === null) throw new Error('The box must be shown');
	await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await expect(page.locator('[data-report-zone]')).toHaveCount(1);
	await page.keyboard.press('Escape');

	await expect(dialog.getByText('1 zone pointée')).toBeVisible();
	await send.click();
	await expect(dialog.getByRole('status')).toHaveText('Merci ! Rapport rapport-1 enregistré.');

	const report = JSON.stringify(sent);
	for (const original of ['ai-generation-orchestration', 'Orchestration of AI', 'Use cases'])
		expect(report).not.toContain(original);
	expect(sent).toMatchObject({
		category: 'crossing',
		comment: 'Deux flèches se croisent',
		checks: { anonymizationDiverged: false, projectionDiverged: false },
		zones: [{ entities: [{ kind: 'node', id: expect.stringMatching(/^e\d+$/) as unknown }] }],
	});

	await dialog.getByRole('button', { name: 'Fermer' }).click();
	await expect(open).toBeFocused();
});
