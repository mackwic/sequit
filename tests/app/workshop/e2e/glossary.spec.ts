import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('edits bilingual terms, discussions and validation, then reloads saved data', async ({
	page,
}) => {
	let document = await readFile('docs/visual-language.md', 'utf8');
	await page.route('**/atelier/lexique/data', async (route) => {
		if (route.request().method() === 'PUT') {
			const body: unknown = route.request().postDataJSON();
			if (
				typeof body !== 'object' ||
				body === null ||
				!('document' in body) ||
				typeof body.document !== 'string'
			)
				throw new Error('Invalid request');
			document = body.document;
			await route.fulfill({ json: { saved: true } });
			return;
		}
		await route.fulfill({ json: { document } });
	});
	await page.goto('/atelier/lexique#VL-101');
	await expect(page.getByLabel('Terme français')).toHaveValue('Document');
	await page.getByLabel('English term').fill('Structured document');
	await page.getByLabel('Notes de discussion').fill('Thomas : préciser la frontière.\nA | B');
	await expect(page.getByLabel('Décision', { exact: true }).locator('option')).toHaveText([
		'todo',
		'to update',
		'ok',
		'???',
	]);
	await page.getByLabel('Décision', { exact: true }).selectOption('???');
	await page.getByLabel('Décision', { exact: true }).selectOption('ok');
	await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
	await expect(page.getByRole('status')).toContainText('Enregistré');
	await page.reload();
	await expect(page.getByLabel('English term')).toHaveValue('Structured document');
	await expect(page.getByLabel('Notes de discussion')).toHaveValue(
		'Thomas : préciser la frontière.\nA | B',
	);
	await expect(page.getByLabel('Décision', { exact: true })).toHaveValue('ok');

	await page.getByRole('button', { name: 'Ajouter un terme' }).click();
	await page.getByLabel('Terme français').fill('Terme de test');
	await page.getByLabel('English term').fill('Test term');
	await page
		.getByLabel('Famille du terme', { exact: true })
		.selectOption('4. Chemins, flèches et raccords');
	await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
	await expect(page.getByRole('status')).toContainText('Enregistré');
	await page.reload();
	await expect(page.getByLabel('Terme français')).toHaveValue('Terme de test');
	await page.getByRole('button', { name: 'Retirer ce terme' }).click();
	await page.getByRole('button', { name: 'Annuler le dernier retrait' }).click();
	await expect(page.getByLabel('Terme français')).toHaveValue('Terme de test');
	await page.getByRole('button', { name: 'Retirer ce terme' }).click();
	await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
	await expect(page.getByRole('status')).toContainText('Enregistré');
	await page.reload();
	await expect(page.getByRole('button', { name: /Terme de test/ })).toHaveCount(0);
	await page.getByLabel('English term').fill('New draft');
	await page.route('**/atelier/lexique/data', (route) => route.fulfill({ status: 409, json: {} }));
	await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
	await expect(page.getByRole('status')).toContainText('Conflit');
	await expect(page.getByLabel('English term')).toHaveValue('New draft');
});
