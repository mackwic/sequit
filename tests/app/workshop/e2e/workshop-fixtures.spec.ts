import { expect, test } from '@playwright/test';

import { LAYOUT_PERFORMANCE_SCENARIO_NAMES } from '../../../../src/app/workshop/fixtures/layout-performance/scenario-name';

for (const fixture of LAYOUT_PERFORMANCE_SCENARIO_NAMES) {
	test(`${fixture}: benchmark document renders and supports navigation`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.goto(`/atelier?scenario=SC-NAV-EXPLORE&fixture=${fixture}&nodes=10`);
		await expect(page.locator('[data-node-id]')).toHaveCount(10);
		await page.getByLabel('Rechercher une boîte').fill('Node 9');
		await page.getByRole('button', { name: 'Node 9', exact: true }).click();
		await expect(page.locator('[data-node-id="node-0000000000000009"]')).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		expect(errors).toEqual([]);
	});
}

test('document choice persists across variants, reload and history; remarks identify the trial', async ({
	page,
}) => {
	await page.goto('/atelier?scenario=SC-BOX-EDIT');
	await expect(page.getByLabel('Document d’essai')).toBeEnabled();
	await page.getByLabel('Document d’essai').selectOption('binary-tree');
	await page.getByLabel('Boîtes', { exact: true }).selectOption('50');
	// Preparing the choice leaves the current attempt intact until explicitly loaded.
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await page.getByRole('button', { name: 'Charger le document' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(50);
	await expect(page.locator('[data-node-id="node-0000000000000000"]')).toBeInViewport();
	await page
		.getByRole('navigation', { name: 'Variantes' })
		.getByRole('button', { name: /Panneau latéral/ })
		.click();
	await expect(page).toHaveURL(/fixture=binary-tree/);
	await expect(page.locator('[data-node-id]')).toHaveCount(50);
	await page.locator('[data-node-id="node-0000000000000000"]').dblclick();
	await page.getByRole('textbox', { name: 'Markdown' }).fill('Un arbre modifié');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(page.locator('[data-node-id="node-0000000000000000"]')).toContainText(
		'Un arbre modifié',
	);
	await page.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await page
		.getByRole('button', { name: 'Noter cet essai : panel / binary-tree-50', exact: true })
		.click();
	await page
		.getByRole('button', { name: 'Noter cet essai : panel / binary-tree-50', exact: true })
		.click();
	await expect(page.getByLabel('Variantes essayées')).toHaveValue('panel / binary-tree-50');
	await page.reload();
	await expect(page.getByLabel('Document d’essai')).toBeEnabled();
	await expect(page.getByLabel('Document d’essai')).toHaveValue('binary-tree');
	await expect(page.locator('[data-node-id="node-0000000000000000"]')).toContainText('Node 0');
	await page.getByLabel('Document d’essai').selectOption('simple');
	await page.getByRole('button', { name: 'Charger le document' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await page.goBack();
	await expect(page.locator('[data-node-id]')).toHaveCount(50);
	await page.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await expect(page.getByLabel('Variantes essayées')).toHaveValue('panel / binary-tree-50');
});

test('a thousand-node tree can locate, edit and recover a distant node', async ({ page }) => {
	test.setTimeout(60000);
	await page.goto('/atelier?scenario=SC-NAV-EXPLORE&fixture=binary-tree&nodes=1000');
	await expect(page.locator('[data-node-id]')).toHaveCount(1000, { timeout: 20000 });
	await page.getByLabel('Rechercher une boîte').fill('Node 999');
	await page.getByRole('button', { name: 'Node 999', exact: true }).click();
	const node = page.locator('[data-node-id="node-0000000000000999"]');
	await expect(node).toBeInViewport();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Markdown' }).fill('La dernière boîte modifiée');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(node).toContainText('La dernière boîte modifiée');
	await page.getByRole('button', { name: 'Annuler la modification' }).click();
	await expect(node).toContainText('Node 999');
});

test('creation uses the fixture nature and reset restores the original benchmark document', async ({
	page,
}) => {
	await page.goto('/atelier?scenario=SC-BOX-CREATE&fixture=shallow-groups&nodes=10');
	await expect(page.locator('[data-node-id]')).toHaveCount(10);
	await page.getByRole('button', { name: 'Nouvelle boîte', exact: true }).click();
	await expect(page.getByLabel('Nature', { exact: true })).toHaveValue('performance-node');
	await page.getByLabel('Contenu', { exact: true }).fill('Une boîte de plus');
	await page.getByRole('button', { name: 'Créer', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(11);
	await page.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(10);
});

test('unsupported complexity is explained and the user can return to a smaller document', async ({
	page,
}) => {
	await page.goto('/atelier?scenario=SC-NAV-EXPLORE&fixture=nested-subgroups&nodes=1000');
	await expect(page.getByRole('alert')).toContainText(
		'Ce document dépasse les limites actuelles du graphe',
	);
	await expect(page.locator('[data-node-id]')).toHaveCount(0);
	await page.getByLabel('Boîtes', { exact: true }).selectOption('10');
	await page.getByRole('button', { name: 'Charger le document' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(10);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('global fixture picker starts simple, shares the homepage document, and keeps the choice between scenarios', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]').first()).toBeVisible();
	const homepageNodes = await page
		.locator('[data-node-id]')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort());
	await page.goto('/atelier');
	const picker = page.getByRole('form', { name: 'Configuration de l’atelier' });
	await expect(picker.getByLabel('Document d’essai')).toHaveValue('simple');
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(picker.getByLabel('Boîtes', { exact: true })).toHaveCount(0);
	await picker.getByLabel('Document d’essai').selectOption('varied');
	await picker.getByRole('button', { name: 'Charger le document' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(homepageNodes.length);
	expect(
		await page
			.locator('[data-node-id]')
			.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')).sort()),
	).toEqual(homepageNodes);
	await page
		.getByRole('navigation', { name: 'Scénarios' })
		.getByRole('button', { name: /SC-GRP-ORGANIZE/ })
		.click();
	await expect(picker.getByLabel('Document d’essai')).toHaveValue('varied');
	await expect(page.locator('[data-node-id]')).toHaveCount(homepageNodes.length);
	await expect(page.getByRole('link', { name: /SC-GRP-ORGANIZE \/ direct/ })).toHaveAttribute(
		'href',
		/fixture=varied$/,
	);
	await page.reload();
	await expect(picker.getByLabel('Document d’essai')).toHaveValue('varied');
	await picker.getByLabel('Document d’essai').selectOption('simple');
	await picker.getByRole('button', { name: 'Charger le document' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(page).not.toHaveURL(/nodes=/);
	await page
		.getByRole('navigation', { name: 'Scénarios' })
		.getByRole('button', { name: /SC-NAV-EXPLORE/ })
		.click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
});
