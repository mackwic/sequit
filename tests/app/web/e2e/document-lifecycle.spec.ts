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

async function downloadDocument(page: Page, format: string) {
	await openMenuItem(page, 'Exporter…');
	const dialog = page.getByRole('dialog', { name: 'Exporter le document' });
	await expect(dialog).toBeVisible();
	const downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: format }).click();
	return downloading;
}

function layoutChip(page: Page) {
	return page.locator('[data-layout-chip] button[aria-haspopup="menu"]');
}

test('the home page starts blank and reopens the recent local document', async ({ page }) => {
	await page.goto('/');
	await expect(menuTrigger(page)).toContainText('Sans titre');
	await expect(page.locator('[data-node-id]')).toHaveCount(0);
	await expect(layoutChip(page)).toHaveText('But en haut');
	expect(await page.evaluate(() => localStorage.getItem('sequit:recent-documents'))).toBeNull();

	await openMenuItem(page, 'Ouvrir…');
	await chooseFile(page, 'petit.sequit.toml', SMALL_DOCUMENT);
	await expect(menuTrigger(page)).toContainText('Petit document');
	await page.goto('/');
	await expect(menuTrigger(page)).toContainText('Petit document');
	await expect(page.locator('[data-node-id="seul"]')).toContainText('Une seule boîte');
});

test('export downloads the current document with its edits', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	const textarea = page.getByRole('textbox', { name: 'Contenu' });
	await textarea.fill('Contenu exporté');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu exporté');

	const download = await downloadDocument(page, 'Sequit (TOML)');
	expect(download.suggestedFilename()).toBe('ai-for-documentary-effort.sequit.toml');
	const exported = await readFile(await download.path(), 'utf8');
	expect(exported).toContain('title = "AI for documentary effort"');
	expect(exported).toContain('Contenu exporté');
});

test('DOT and Excalidraw exports contain the edited example graph', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await expect(node).toBeVisible();
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Contenu exporté');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu exporté');

	const dotDownload = await downloadDocument(page, 'Graphviz (DOT)');
	expect(dotDownload.suggestedFilename()).toBe('ai-for-documentary-effort.dot');
	const dot = await readFile(await dotDownload.path(), 'utf8');
	expect(dot).toMatch(/^digraph\b/);
	expect(dot).toContain('"traceable-edits"');
	expect(dot).toMatch(/"word-alcoa-question"\s*->\s*"traceable-edits"/);
	expect(dot).toContain('Contenu exporté');

	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Exporter le document' })).toHaveCount(0);
	await openMenuItem(page, 'Exporter…');
	const dialog = page.getByRole('dialog', { name: 'Exporter le document' });
	const excalidrawButton = dialog.getByRole('button', { name: 'Excalidraw' });
	await expect(excalidrawButton).toBeEnabled();
	const downloading = page.waitForEvent('download');
	await excalidrawButton.click();
	const excalidrawDownload = await downloading;
	expect(excalidrawDownload.suggestedFilename()).toBe('ai-for-documentary-effort.excalidraw');
	const excalidraw: unknown = JSON.parse(await readFile(await excalidrawDownload.path(), 'utf8'));
	expect(excalidraw).toEqual(
		expect.objectContaining({
			type: 'excalidraw',
			version: expect.any(Number),
			elements: expect.any(Array),
		}),
	);
	if (typeof excalidraw !== 'object' || excalidraw === null || !('elements' in excalidraw)) {
		throw new Error('Expected Excalidraw elements');
	}
	expect(excalidraw.elements).toEqual(
		expect.arrayContaining([
			// The example's `need` nature is #f4c400; the canvas tints its border and header.
			expect.objectContaining({
				id: 'sequit:["endpoint","traceable-edits"]',
				type: 'rectangle',
				strokeColor: '#e1ce88',
				roundness: { type: 3 },
			}),
			expect.objectContaining({
				id: 'sequit:["node-header","traceable-edits"]',
				backgroundColor: '#fef7de',
			}),
			expect.objectContaining({ type: 'arrow' }),
			expect.objectContaining({ type: 'text', text: expect.stringContaining('Contenu exporté') }),
		]),
	);
});

function pngSize(png: Buffer): [number, number] {
	expect(png.subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
	// IHDR follows the signature: width and height are its first two big-endian words.
	return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test('image export offers the whole stage or the selection, scaled, as PNG or SVG', async ({
	page,
}) => {
	await page.goto('/examples/ai-documentary-effort');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await expect(node).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Zoom arrière' }).click();
	const stage = page.locator('[data-graph-stage]');
	await expect(stage).toHaveCSS('transform', /matrix\(0\.9/);
	const stageSize = await stage.evaluate((element): [number, number] => [
		element.clientWidth,
		element.clientHeight,
	]);

	await openMenuItem(page, 'Exporter l’image…');
	const dialog = page.getByRole('dialog', { name: 'Exporter l’image' });
	const selectionOnly = dialog.getByRole('switch', { name: 'Uniquement la sélection' });
	const size = dialog.locator('[data-export-size]');
	await expect(selectionOnly).toBeChecked();
	await expect(dialog.locator('[data-export-preview] img')).toBeVisible();
	await selectionOnly.click();
	// The whole stage is far wider than the box: the preview shrinks it instead of clipping it.
	await expect
		.poll(() =>
			dialog.locator('[data-export-preview]').evaluate((box) => {
				const picture = box.querySelector('img');
				if (picture === null || picture.naturalWidth === 0) return 'not rendered';
				const outer = box.getBoundingClientRect();
				const inner = picture.getBoundingClientRect();
				return inner.right <= outer.right && inner.bottom <= outer.bottom && inner.width > 200;
			}),
		)
		.toBe(true);
	await selectionOnly.click();
	await dialog.getByRole('radio', { name: '3×' }).click();
	const announced = (await size.textContent())?.trim();
	let downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'PNG' }).click();
	let download = await downloading;
	expect(download.suggestedFilename()).toBe('ai-for-documentary-effort.png');
	const [width, height] = pngSize(await readFile(await download.path()));
	expect(`${width} × ${height} px`).toBe(announced);
	expect(width).toBeLessThan(stageSize[0] * 3);

	await selectionOnly.click();
	await dialog.getByRole('radio', { name: '1×' }).click();
	await dialog.getByLabel('Nom du fichier').fill('schema complet');
	await expect(size).toHaveText(`${stageSize[0]} × ${stageSize[1]} px`);
	downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'PNG' }).click();
	download = await downloading;
	expect(download.suggestedFilename()).toBe('schema complet.png');
	expect(pngSize(await readFile(await download.path()))).toEqual(stageSize);

	await dialog.getByRole('switch', { name: 'Fond' }).click();
	downloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'SVG' }).click();
	download = await downloading;
	expect(download.suggestedFilename()).toBe('schema complet.svg');
	const svg = await readFile(await download.path(), 'utf8');
	expect(svg).toMatch(new RegExp(`^<svg [^>]*width="${stageSize[0]}" height="${stageSize[1]}"`));
	expect(svg).not.toContain('fill="#ffffff"');
	expect(svg).toContain('data-node-id="traceable-edits"');

	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(stage).not.toHaveAttribute('data-exporting');
	await expect(node).toHaveAttribute('aria-pressed', 'true');
});

test('printing shows the stage alone, unzoomed, fitted on one sheet', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const stage = page.locator('[data-graph-stage]');
	await expect(stage.locator('[data-node-id]')).toHaveCount(24);
	await page.getByRole('button', { name: 'Zoom arrière' }).click();
	await expect(stage).toHaveCSS('transform', /matrix\(0\.9/);
	const scale = await stage.evaluate((element) =>
		Number(element.style.getPropertyValue('--print-scale')),
	);
	expect(scale).toBeGreaterThan(0);
	expect(scale).toBeLessThan(1);

	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('header')).toBeHidden();
	await expect(page.getByRole('navigation', { name: 'Actions du canvas' })).toBeHidden();
	await expect(page.locator('[data-layout-chip]')).toBeHidden();
	await expect(page.locator('[data-canvas-viewport]')).toHaveCSS('position', 'static');
	await expect(stage).toHaveCSS('transform', 'none');
	expect(await stage.evaluate((element) => Number(getComputedStyle(element).zoom))).toBeCloseTo(
		scale,
		4,
	);
});

test('opening a file replaces the document, and an invalid file keeps it', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(0);

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

	const download = await downloadDocument(page, 'Sequit (TOML)');
	const exported = await readFile(await download.path(), 'utf8');
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

	const lanesButton = page.locator('[data-layout-chip] [data-lanes-button]');
	await expect(lanesButton).toHaveText('Layout simple');
	await lanesButton.click();
	const dialog = page.getByRole('dialog', { name: 'Lanes' });
	await dialog.getByRole('button', { name: 'Activer les lanes' }).click();
	await dialog.getByRole('textbox', { name: 'Nom de la lane 1' }).fill('Ventes');
	await dialog.getByRole('textbox', { name: 'Nom de la lane 2' }).fill('Client');
	await dialog.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-lane-id]')).toHaveCount(2);
	await expect(lanesButton).toHaveText('2 lanes');
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);

	const client = page.locator('[data-lane-id]').nth(1);
	await expect(client).toContainText('Client');
	await client.dblclick({ position: { x: 40, y: 40 } });
	const draft = page.locator('[data-node-draft]');
	const content = draft.getByRole('textbox', { name: 'Contenu de la nouvelle boîte' });
	await expect(content).toBeFocused();
	await content.fill('Dans la lane Client');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(draft).toHaveCount(0);
	const created = page.locator('[data-node-id]', { hasText: 'Dans la lane Client' });
	await expect(created).toBeVisible();
	const laneBox = await client.boundingBox();
	const nodeBox = await created.boundingBox();
	if (laneBox === null || nodeBox === null) throw new Error('Expected visible lane and node');
	expect(nodeBox.y).toBeGreaterThan(laneBox.y);
	expect(nodeBox.y + nodeBox.height).toBeLessThan(laneBox.y + laneBox.height);

	const download = await downloadDocument(page, 'Sequit (TOML)');
	const exported = await readFile(await download.path(), 'utf8');
	expect(exported).toContain('persistenceFormat = 3');
	expect(exported).toContain('laneOrientation = "parallel"');
	expect(exported).toMatch(/label = "Client"/);
});

test('a file the canvas refuses keeps the edited document and its export', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
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

	const download = await downloadDocument(page, 'Sequit (TOML)');
	const exported = await readFile(await download.path(), 'utf8');
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
	await page.goto('/examples/ai-documentary-effort');
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
	await page.goto('/examples/ai-documentary-effort');
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
