import { expect, test } from '@playwright/test';

for (const label of ['Modale']) {
	test(`workshop ${label}: save, cancel and restart`, async ({ page }) => {
		await page.goto('/atelier');
		const variant = page.getByRole('button', { name: label, exact: false });
		await variant.click();
		await expect(variant).toHaveAttribute('aria-pressed', 'true');
		const node = page.locator('[data-node-id="comparer"]');
		await expect(node).toBeVisible();
		await node.dblclick();
		const input = page.getByRole('textbox', { name: 'Contenu', exact: true });
		await expect(input).toBeFocused();
		await input.fill('Comparer les options\nObserver le contexte\nChoisir ensemble');
		await page.getByRole('button', { name: /^(Save|Enregistrer)$/ }).click();
		await expect(input).toHaveCount(0);
		await expect(node).toContainText('Choisir ensemble');
		await expect(node).toBeFocused();
		await node.press('Enter');
		await page
			.getByRole('textbox', { name: 'Contenu', exact: true })
			.fill('Brouillon à abandonner');
		await page.keyboard.press('Escape');
		await expect(node).toContainText('Choisir ensemble');
		await expect(node).toBeFocused();
		await page.getByRole('button', { name: 'Recommencer' }).click();
		await expect(node).toHaveText(/Comparer les options/);
		await expect(node).not.toContainText('Choisir ensemble');
	});
}

test('the editing scenario combines saving and cancellation', async ({ page }) => {
	await page.goto('/atelier');
	const scenarios = page.getByRole('navigation', { name: 'Scénarios' });
	await expect(scenarios.getByRole('button')).toHaveCount(15);
	await scenarios.getByRole('button', { name: /SC-BOX-EDIT/ }).click();
	const node = page.locator('[data-node-id="comparer"]');
	await node.dblclick();
	await page.getByRole('textbox', { name: 'Contenu', exact: true }).fill('Version enregistrée');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Version enregistrée');
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu', exact: true }).fill('Brouillon annulé');
	await page.keyboard.press('Escape');
	await expect(node).toContainText('Version enregistrée');
});

for (const label of ['Modale']) {
	test(`floating toolbox shortcut: ${label}`, async ({ page }) => {
		await page.goto('/atelier');
		await page.getByRole('button', { name: label, exact: false }).click();
		const node = page.locator('[data-node-id="comparer"]');
		await node.click();
		const toolbar = page.getByRole('group', { name: 'Actions du nœud' });
		await expect(toolbar).toBeVisible();
		await expect(toolbar.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'e');
		await node.press('Control+e');
		await expect(page.getByRole('textbox')).toHaveCount(0);
		await node.press('e');
		const input = page.getByRole('textbox', { name: 'Contenu', exact: true });
		await expect(input).toBeFocused();
		await input.fill('Lettr');
		await input.press('e');
		await expect(input).toHaveText('Lettre');
		await page.keyboard.press('Escape');
		await expect(node).toBeFocused();
		await expect(toolbar).toBeVisible();
		await page.getByRole('button', { name: 'Recommencer' }).click();
		await page.keyboard.press('e');
		await expect(input).toHaveCount(0);
	});
}
