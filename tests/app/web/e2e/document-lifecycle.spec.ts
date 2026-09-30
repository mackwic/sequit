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

const OTHER_DOCUMENT = SMALL_DOCUMENT.replace('petit-document', 'autre-document')
	.replace('Petit document', 'Autre document')
	.replace('Une seule boîte', 'Autre boîte');

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

function layoutChip(page: Page) {
	return page.locator('[data-layout-chip] button[aria-haspopup="menu"]');
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
	await expect(layoutChip(page)).toHaveText('But à gauche');

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

test('the layout chip changes the direction and keeps the chosen side', async ({ page }) => {
	await page.goto('/');
	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	const chip = layoutChip(page);
	const menu = page.getByRole('menu', { name: 'Mise en page' });
	await expect(chip).toHaveText('But à gauche');

	await chip.click();
	await expect(menu.getByRole('menuitemradio', { name: 'But à gauche' })).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await expect(menu.getByRole('menuitemradio', { name: 'Serrer vers le but' })).toHaveAttribute(
		'aria-checked',
		'true',
	);
	await menu.getByRole('menuitemradio', { name: 'Aligner les points de départ' }).click();
	await expect(menu).toHaveCount(0);

	await chip.click();
	await menu.getByRole('menuitemradio', { name: 'But en haut' }).click();
	await expect(chip).toHaveText('But en haut');
	await chip.click();
	await expect(
		menu.getByRole('menuitemradio', { name: 'Aligner les points de départ' }),
	).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');

	const downloading = page.waitForEvent('download');
	await openMenuItem(page, 'Exporter…');
	const exported = await readFile(await (await downloading).path(), 'utf8');
	expect(exported).toContain('direction = "top-to-bottom"');
	expect(exported).toContain('bias = "bottom"');
});

test('lanes are activated from the chip, and a double-click on a lane creates a box inside', async ({
	page,
}) => {
	await page.goto('/');
	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	const chip = layoutChip(page);
	await expect(chip).toHaveText('But à gauche');

	await chip.click();
	await page.getByRole('menuitem', { name: 'Lanes…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Lanes' });
	await dialog.getByRole('button', { name: 'Activer les lanes' }).click();
	await dialog.getByRole('textbox', { name: 'Nom de la lane 1' }).fill('Ventes');
	await dialog.getByRole('textbox', { name: 'Nom de la lane 2' }).fill('Client');
	await dialog.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-lane-id]')).toHaveCount(2);
	await expect(chip).toContainText('2 lanes');
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);

	const client = page.locator('[data-lane-id]').nth(1);
	await expect(client).toContainText('Client');
	await client.dblclick({ position: { x: 40, y: 40 } });
	const creator = page.getByRole('dialog', { name: 'Nouvelle boîte' });
	await expect(creator.getByRole('combobox', { name: 'Lane' })).toHaveValue(/lane-/);
	await expect(
		creator.getByRole('combobox', { name: 'Lane' }).locator('option:checked'),
	).toHaveText('Client');
	await creator.getByRole('textbox', { name: 'Contenu' }).fill('Dans la lane Client');
	await creator.getByRole('button', { name: 'Créer' }).click();
	await expect(creator).toHaveCount(0);
	const created = page.locator('[data-node-id]', { hasText: 'Dans la lane Client' });
	const laneBox = await client.boundingBox();
	const nodeBox = await created.boundingBox();
	if (laneBox === null || nodeBox === null) throw new Error('Expected visible lane and node');
	expect(nodeBox.y).toBeGreaterThan(laneBox.y);
	expect(nodeBox.y + nodeBox.height).toBeLessThan(laneBox.y + laneBox.height);

	const downloading = page.waitForEvent('download');
	await openMenuItem(page, 'Exporter…');
	const exported = await readFile(await (await downloading).path(), 'utf8');
	expect(exported).toContain('persistenceFormat = 3');
	expect(exported).toContain('laneOrientation = "parallel"');
	expect(exported).toMatch(/label = "Client"/);
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

test('edits and opened files survive a reload', async ({ page }) => {
	await page.goto('/');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Contenu conservé');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu conservé');

	await page.reload();
	await expect(page.locator('[data-node-id="traceable-edits"]')).toContainText('Contenu conservé');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);

	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	await expect(menuTrigger(page)).toContainText('Petit document');
	await page.reload();
	await expect(menuTrigger(page)).toContainText('Petit document');
	await expect(page.locator('[data-node-id="seul"]')).toContainText('Une seule boîte');
});

test('recent documents can be reopened and forgotten', async ({ page }) => {
	await page.goto('/');
	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	await expect(menuTrigger(page)).toContainText('Petit document');
	await openMenuItem(page, 'Ouvrir…');
	const openDialog = page.getByRole('dialog', { name: 'Ouvrir un document' });
	await expect(openDialog).toContainText('reste disponible dans « Documents récents… »');
	await chooseFile(page, 'autre.sequit.toml', OTHER_DOCUMENT);
	await expect(menuTrigger(page)).toContainText('Autre document');

	await openMenuItem(page, 'Documents récents…');
	const dialog = page.getByRole('dialog', { name: 'Documents récents' });
	const entries = dialog.getByRole('listitem');
	await expect(entries).toHaveCount(2);
	await expect(entries.nth(0)).toContainText('Autre document (ouvert)');
	await expect(entries.nth(1)).toContainText('Petit document');
	await expect(dialog.getByRole('button', { name: 'Ouvrir Autre document' })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Ouvrir Petit document' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(menuTrigger(page)).toContainText('Petit document');
	await expect(page.locator('[data-node-id="seul"]')).toContainText('Une seule boîte');

	await openMenuItem(page, 'Documents récents…');
	await dialog.getByRole('button', { name: 'Retirer Autre document' }).click();
	await expect(entries).toHaveCount(1);
	await expect(entries.nth(0)).toContainText('Petit document (ouvert)');
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
});

test('leaving with edits the browser cannot keep asks for confirmation', async ({ page }) => {
	await page.addInitScript(() => {
		Storage.prototype.setItem = () => {
			throw new Error('quota exceeded');
		};
	});
	await page.goto('/');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Contenu perdu');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu perdu');

	await openMenuItem(page, 'Ouvrir…');
	const openDialog = page.getByRole('dialog', { name: 'Ouvrir un document' });
	await expect(openDialog).toContainText('remplacé sans être enregistré');
	await page.keyboard.press('Escape');

	const prompted = page.waitForEvent('dialog');
	const reloaded = page.reload();
	const prompt = await prompted;
	expect(prompt.type()).toBe('beforeunload');
	await prompt.accept();
	await reloaded;
	await expect(page.locator('[data-node-id="traceable-edits"]')).not.toContainText('Contenu perdu');
});
