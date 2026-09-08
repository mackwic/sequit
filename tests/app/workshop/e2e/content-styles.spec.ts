import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

async function openStyle(page: Page): Promise<void> {
	await page.goto('/atelier?scenario=SC-NAT-STYLE&variant=node');
	await page.locator('[data-node-id="comparer"]').click();
	await expect(page.getByRole('region', { name: 'Présentation du content' })).toBeVisible();
}

async function chooseColor(page: Page, color: string): Promise<void> {
	await page.getByLabel('Couleur personnalisée', { exact: true }).fill(color);
}

async function chooseIcon(page: Page, name: string): Promise<void> {
	const picker = page.locator('details.icon-picker');
	if ((await picker.getAttribute('open')) === null) await picker.locator('summary').click();
	await page.getByRole('searchbox', { name: 'Rechercher une icône' }).fill(name);
	await page
		.getByRole('group', { name: 'Icônes Phosphor' })
		.getByRole('button', { name, exact: true })
		.click();
}

test('nature changes propagate; node color and icon inherit or override independently', async ({
	page,
}) => {
	await openStyle(page);
	const current = page.locator('[data-node-id="comparer"]');
	const sibling = page.locator('[data-node-id="collecter"]');
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:lightning');
	await page.getByRole('button', { name: 'Sa nature', exact: true }).click();
	await chooseColor(page, '#eab308');
	await chooseIcon(page, 'scales');
	await expect(current).toHaveAttribute('data-content-color', '#eab308');
	await expect(sibling).toHaveAttribute('data-content-icon', 'phosphor:scales');
	await page.getByRole('button', { name: 'Ce nœud', exact: true }).click();
	await chooseColor(page, '#b91c1c');
	await chooseIcon(page, 'lightbulb');
	await page.getByRole('button', { name: 'Sa nature', exact: true }).click();
	await chooseColor(page, '#14b8a6');
	await expect(sibling).toHaveAttribute('data-content-color', '#14b8a6');
	await expect(current).toHaveAttribute('data-content-color', '#b91c1c');
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:lightbulb');
	await expect(current).toHaveCSS('outline-style', 'solid');
	await expect(current).toHaveCSS('outline-color', 'rgb(81, 69, 205)');
	await page.getByRole('button', { name: 'Ce nœud', exact: true }).click();
	await page.getByRole('button', { name: 'Hériter de la couleur', exact: true }).click();
	await expect(current).toHaveAttribute('data-content-color', '#14b8a6');
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:lightbulb');
	await page.getByRole('button', { name: 'Hériter de l’icône', exact: true }).click();
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:scales');
	await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click();
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:lightbulb');
	await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
	await expect(current).toHaveAttribute('data-content-icon', 'phosphor:scales');
});

test('styles export and import with the document, including explicit absence of an icon', async ({
	page,
}) => {
	await openStyle(page);
	await chooseColor(page, '#123456');
	await page.locator('details.icon-picker summary').click();
	await page.getByRole('button', { name: 'Sans icône', exact: true }).click();
	await expect(page.locator('[data-node-id="comparer"] .node-header [data-icon]')).toHaveCount(0);
	const downloadEvent = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Exporter le document', exact: true }).click();
	const download = await downloadEvent;
	const path = await download.path();
	const source = await readFile(path, 'utf8');
	expect(source).toContain('icon = "none"');
	expect(source).toContain('color = "#123456"');
	await page.goto('/atelier?scenario=SC-DOC-LIFECYCLE&variant=sheet');
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await page.getByLabel('Texte à importer').fill(source);
	await page.getByRole('button', { name: 'Importer le texte', exact: true }).click();
	const node = page.locator('[data-node-id="comparer"]');
	await expect(node).toHaveAttribute('data-content-color', '#123456');
	await expect(node).toHaveAttribute('data-content-icon', 'none');
	await node.dblclick();
	await page.getByRole('textbox', { name: 'Node Markdown' }).fill('Texte modifié, style conservé');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(node).toHaveAttribute('data-content-color', '#123456');
	await expect(node).toContainText('Texte modifié, style conservé');
});

test('palette and full icon search work by keyboard and keep E scoped to the canvas', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openStyle(page);
	await page.getByText('Palette · 54 couleurs', { exact: true }).click();
	const swatch = page.getByRole('button', { name: 'Jaune clair', exact: true });
	await swatch.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-node-id="comparer"]')).toHaveAttribute(
		'data-content-color',
		'#fef08a',
	);
	await page.locator('details.icon-picker summary').click();
	await page.getByRole('searchbox', { name: 'Rechercher une icône' }).fill('tree evergreen');
	const icon = page.getByRole('button', { name: 'tree evergreen', exact: true });
	await icon.focus();
	await page.keyboard.press('Enter');
	await expect(page.locator('[data-node-id="comparer"]')).toHaveAttribute(
		'data-content-icon',
		'phosphor:tree-evergreen',
	);
	await page.getByRole('searchbox', { name: 'Rechercher une icône' }).fill('');
	await page.keyboard.press('e');
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('searchbox', { name: 'Rechercher une icône' })).toHaveValue('e');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.locator('[data-node-id="comparer"]').focus();
	await page.keyboard.press('e');
	await expect(page.getByRole('dialog')).toBeVisible();
});

test('nature presentation applies on a thousand-node performance fixture', async ({ page }) => {
	await page.goto('/atelier?scenario=SC-NAT-STYLE&variant=nature&fixture=binary-tree&nodes=1000');
	const nodes = page.locator('[data-node-id]');
	await expect(nodes).toHaveCount(1000);
	await nodes.first().click();
	await chooseIcon(page, 'star');
	await chooseColor(page, '#f97316');
	await expect(
		page.locator('[data-node-id][data-content-icon="phosphor:star"][data-content-color="#f97316"]'),
	).toHaveCount(1000);
	await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click();
	await expect(page.locator('[data-node-id][data-content-icon="phosphor:star"]')).toHaveCount(1000);
	await expect(page.locator('[data-node-id][data-content-color="#f97316"]')).toHaveCount(0);
});

test('content keeps dark readable labels and prints identifiable monochrome cards', async ({
	page,
}) => {
	await openStyle(page);
	await chooseColor(page, '#ffffff');
	const node = page.locator('[data-node-id="comparer"]');
	await expect(node.locator('.node-header')).toHaveCSS('color', 'rgb(41, 37, 36)');
	const icon = node.locator('[data-icon="phosphor:lightning"]');
	await expect(icon.locator('.screen')).toHaveCSS('mask-image', /lightning\.svg/);
	await page.emulateMedia({ media: 'print' });
	await expect(node.locator('.node-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
	await expect(node.locator('.node-header')).toHaveCSS('color', 'rgb(0, 0, 0)');
	await expect(node).toHaveCSS('outline-style', 'none');
	await expect(icon.locator('img')).toBeVisible();
	await expect
		.poll(() =>
			icon
				.locator('img')
				.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
		)
		.toBe(true);
});
