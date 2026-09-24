import { expect, test } from '@playwright/test';

import { LAYOUT_DIRECTIONS } from '../../../../src/lib/core/document/logic-document';

test('the folded source-route prototype is inspectable in all four directions', async ({
	page,
}) => {
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'G replié' }).click();
	const preview = page.locator('[data-folded-route-preview]');
	const direction = preview.getByRole('combobox', { name: 'Direction du témoin replié' });
	for (const value of LAYOUT_DIRECTIONS) {
		await direction.selectOption(value);
		await expect(preview.getByRole('status')).toContainText('Validation géométrique réussie.');
		await expect(preview.locator('[data-witness-box]')).toHaveCount(2);
		await expect(preview.locator('[data-witness-route]')).toHaveCount(2);
		await expect(preview.locator('[data-witness-attachment-group]')).toHaveCount(2);
		await expect(preview).toContainText('A : 0');
		await expect(preview).toContainText('x : 1');
		await expect(preview).toContainText('B : 2');
		await expect(preview).toContainText('B-to-x');
		await expect(preview).toContainText('x-to-A');
	}
});
