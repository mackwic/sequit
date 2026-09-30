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
	const first = menu.getByRole('menuitem', { name: 'Ouvrir…' });
	await expect(first).toBeFocused();
	await first.hover();
	await expect(first).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await trigger.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'Ouvrir…' })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(menu).toHaveCount(0);
});
