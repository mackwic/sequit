import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('document menu is responsive, animated, and keyboard accessible', async ({ page }) => {
	await page.goto('/');

	const trigger = page.getByRole('button', { name: /AI for documentary effort/ });
	const menu = page.getByRole('menu', { name: 'Menu du document' });
	await expect(page.getByLabel('Document synchronisé')).toHaveCount(0);
	await expect(trigger).toBeEnabled();

	await trigger.hover();
	await expect(trigger).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect(menu).toBeVisible();
	const animationDuration = await menu.evaluate((element) => {
		const animation = element.getAnimations()[0];
		return animation?.effect?.getTiming().duration;
	});
	expect(animationDuration).toBe(110);
	const first = menu.getByRole('menuitem', { name: 'Renommer le document' });
	await expect(first).toBeFocused();
	await first.hover();
	await expect(first).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await trigger.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'Renommer le document' })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(menu).toHaveCount(0);
});

test('« Renommer le document » turns the title into a field', async ({ page }) => {
	await page.goto('/');
	const trigger = page.locator('header button[aria-haspopup="menu"]');
	const field = page.getByRole('textbox', { name: 'Titre du document' });
	const rename = async (): Promise<void> => {
		await trigger.click();
		await page.getByRole('menuitem', { name: 'Renommer le document' }).click();
		await expect(field).toBeFocused();
	};
	await expect(field).toHaveCount(0);

	// The whole title starts selected, so typing replaces it; Enter keeps it.
	await rename();
	await expect(field).toHaveValue('AI for documentary effort');
	expect(
		await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
	).toEqual([0, 'AI for documentary effort'.length]);
	await page.keyboard.type('  Feuille de route  ');
	await page.keyboard.press('Enter');
	await expect(field).toHaveCount(0);
	await expect(trigger).toHaveText('Feuille de route');
	await expect(trigger).toBeFocused();

	// Escape and an emptied title both keep the current title.
	await rename();
	await page.keyboard.type('Brouillon');
	await page.keyboard.press('Escape');
	await expect(trigger).toHaveText('Feuille de route');
	await expect(trigger).toBeFocused();
	await rename();
	await field.fill('   ');
	await field.press('Enter');
	await expect(trigger).toHaveText('Feuille de route');

	// Clicking elsewhere keeps what was typed.
	await rename();
	await page.keyboard.type('Plan 2027');
	await page.locator('[data-node-id]').first().click();
	await expect(field).toHaveCount(0);
	await expect(trigger).toHaveText('Plan 2027');

	const downloading = page.waitForEvent('download');
	await trigger.click();
	await page.getByRole('menuitem', { name: 'Exporter…' }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('plan-2027.sequit.toml');
	expect(await readFile(await download.path(), 'utf8')).toContain('title = "Plan 2027"');

	await page.reload();
	await expect(trigger).toHaveText('Plan 2027');
});
