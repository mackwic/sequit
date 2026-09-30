import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

const SMALL_DOCUMENT = `persistenceFormat = 2
[document]
id = "petit-document"
title = "Petit document"
[layout]
direction = "left-to-right"
bias = "left"
[natures.action]
label = "Action"
color = "#6f70e8"
[nodes.seul]
nature = "action"
layoutOrder = "a0"
markdown = "Une seule boîte"
[groups]
[junctions]
[relations]
`;

const CYCLIC_DOCUMENT = `persistenceFormat = 2
[document]
id = "cycle"
title = "Cycle"
[layout]
direction = "top-to-bottom"
bias = "top"
[natures.action]
label = "Action"
color = "#6f70e8"
[nodes.a]
nature = "action"
layoutOrder = "a0"
markdown = "A"
[nodes.b]
nature = "action"
layoutOrder = "a1"
markdown = "B"
[relations.a-b]
from = "a"
to = "b"
[relations.b-a]
from = "b"
to = "a"
[groups]
[junctions]
`;

async function chooseFile(page: Page, name: string, content: string): Promise<void> {
	await page
		.getByRole('dialog', { name: 'Ouvrir un document' })
		.getByLabel('Fichier Sequit (.sequit.toml)')
		.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content, 'utf8') });
}

function menuTrigger(page: Page) {
	return page.locator('header button[aria-haspopup="menu"]');
}

async function openMenuItem(page: Page, name: string): Promise<void> {
	await menuTrigger(page).click();
	await page.getByRole('menuitem', { name }).click();
}

test('export downloads the current document with its edits', async ({ page }) => {
	await page.goto('/');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	const textarea = page.getByRole('textbox', { name: 'Contenu' });
	await textarea.fill('Contenu exporté');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu exporté');

	const downloading = page.waitForEvent('download');
	await openMenuItem(page, 'Exporter…');
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('ai-for-documentary-effort.sequit.toml');
	const exported = await readFile(await download.path(), 'utf8');
	expect(exported).toContain('title = "AI for documentary effort"');
	expect(exported).toContain('Contenu exporté');
});

test('opening a file replaces the document, and an invalid file keeps it', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);

	await openMenuItem(page, 'Ouvrir…');
	const dialog = page.getByRole('dialog', { name: 'Ouvrir un document' });
	await expect(dialog).toBeVisible();
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-node-id]')).toHaveCount(1);
	await expect(menuTrigger(page)).toContainText('Petit document');
	await expect(page.getByText('Disposition automatique · De gauche à droite')).toBeVisible();

	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'cassé.toml', 'persistenceFormat = 2\n[document]\nid = "x"\n');
	await expect(dialog.getByRole('alert')).toContainText(
		'cassé.toml n’est pas un document Sequit valide.',
	);
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-node-id]')).toHaveCount(1);
	await expect(menuTrigger(page)).toContainText('Petit document');
});

test('a file the canvas refuses keeps the edited document and its export', async ({ page }) => {
	await page.goto('/');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Édition conservée');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Édition conservée');

	await openMenuItem(page, 'Ouvrir…');
	const dialog = page.getByRole('dialog', { name: 'Ouvrir un document' });
	await chooseFile(page, 'cycle.sequit.toml', CYCLIC_DOCUMENT);
	await expect(dialog.getByRole('alert')).toContainText(
		'cycle.sequit.toml n’est pas un document Sequit valide.',
	);
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	await expect(node).toContainText('Édition conservée');

	const downloading = page.waitForEvent('download');
	await openMenuItem(page, 'Exporter…');
	const exported = await readFile(await (await downloading).path(), 'utf8');
	expect(exported).toContain('Édition conservée');
});

test('reopening the same file after an edit restores its content', async ({ page }) => {
	await page.goto('/');
	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	const node = page.locator('[data-node-id="seul"]');
	await expect(node).toContainText('Une seule boîte');
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Boîte modifiée');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Boîte modifiée');

	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	await expect(page.getByRole('dialog', { name: 'Ouvrir un document' })).toHaveCount(0);
	await expect(page.locator('[data-node-id="seul"]')).toContainText('Une seule boîte');
});
