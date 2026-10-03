import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

function menuTrigger(page: Page) {
	return page.locator('header button[aria-haspopup="menu"]');
}

async function connected(page: Page): Promise<void> {
	await expect(page.getByRole('status').filter({ hasText: 'Connecté' })).toBeVisible();
}

function participants(page: Page): Promise<(string | null)[]> {
	return page
		.getByRole('list', { name: 'Participants' })
		.getByRole('listitem')
		.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
}

test('starting a session publishes the current document and shares its link', async ({
	page,
	context,
}) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.goto('/examples/ai-documentary-effort');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await node.click();
	await node.press('e');
	await page.getByRole('textbox', { name: 'Contenu' }).fill('Contenu partagé');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(node).toContainText('Contenu partagé');

	await page.getByRole('button', { name: 'Collaborer' }).click();
	const start = page.getByRole('dialog', { name: 'Session collaborative' });
	await expect(start.getByLabel('Ton nom')).toBeFocused();
	await expect(start.getByRole('button', { name: 'Démarrer la session' })).toBeDisabled();
	await start.getByLabel('Ton nom').fill('Alice');
	await start.getByRole('button', { name: 'Démarrer la session' }).click();

	await expect(page).toHaveURL(/\/session\/[a-z0-9]{20}$/);
	await connected(page);
	await expect(page.locator('[data-node-id="traceable-edits"]')).toContainText('Contenu partagé');
	await expect(menuTrigger(page)).toContainText('AI for documentary effort');
	await expect.poll(() => participants(page)).toEqual(['Alice']);

	await page.getByRole('button', { name: 'Partager' }).click();
	const share = page.getByRole('dialog', { name: 'Session collaborative' });
	const link = share.getByLabel('Lien de la session');
	await expect(link).toHaveValue(page.url());
	await share.getByRole('button', { name: 'Copier le lien' }).click();
	await expect(share.getByRole('button', { name: 'Lien copié' })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
	await expect(share.getByLabel('Ton nom')).toHaveValue('Alice');

	// The menu no longer offers local-only actions inside a session.
	await page.keyboard.press('Escape');
	await menuTrigger(page).click();
	await expect(page.getByRole('menuitem')).toHaveText([
		'Renommer le document',
		'Exporter…',
		'Exporter l’image…',
		'Imprimer…',
	]);
});

test('a collaborative session exports its graph as DOT and Excalidraw', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	await joinFromLink(page, `/session/${room}`, 'Alice');
	await expect(page.locator('[data-node-id="A"]')).toContainText('Alpha');
	await expect(page.locator('[data-node-id="B"]')).toContainText('Bravo');

	await menuTrigger(page).click();
	await page.getByRole('menuitem', { name: 'Exporter…' }).click();
	let dialog = page.getByRole('dialog', { name: 'Exporter le document' });
	await expect(dialog).toBeVisible();
	const dotDownloading = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Graphviz (DOT)' }).click();
	const dotDownload = await dotDownloading;
	expect(dotDownload.suggestedFilename()).toBe('deux-boites.dot');
	const dot = await readFile(await dotDownload.path(), 'utf8');
	expect(dot).toMatch(/^digraph\b/);
	expect(dot).toContain('"A" [label="Alpha"');
	expect(dot).toContain('"B" [label="Bravo"');
	expect(dot).toMatch(/"B"\s*->\s*"A"/);

	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await menuTrigger(page).click();
	await page.getByRole('menuitem', { name: 'Exporter…' }).click();
	dialog = page.getByRole('dialog', { name: 'Exporter le document' });
	const excalidrawButton = dialog.getByRole('button', { name: 'Excalidraw' });
	await expect(excalidrawButton).toBeEnabled();
	const excalidrawDownloading = page.waitForEvent('download');
	await excalidrawButton.click();
	const excalidrawDownload = await excalidrawDownloading;
	expect(excalidrawDownload.suggestedFilename()).toBe('deux-boites.excalidraw');
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
			expect.objectContaining({ type: 'rectangle' }),
			expect.objectContaining({ type: 'arrow' }),
			expect.objectContaining({ type: 'text', text: 'Alpha' }),
			expect.objectContaining({ type: 'text', text: 'Bravo' }),
		]),
	);
});

test('copies and pastes a box within one shared document', async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'Clipboard permissions are exercised in Chromium');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	await joinFromLink(page, `/session/${room}`, 'Alice');
	await page.locator('[data-node-id="A"]').click();
	await page.keyboard.press('ControlOrMeta+c');
	await page.locator('[data-node-id="B"]').click();
	await page.keyboard.press('ControlOrMeta+v');
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	const copied = page.locator('[data-node-id][aria-pressed="true"]');
	await expect(copied).toContainText('Alpha');
	await expect(page.locator('[data-relation-id]')).toHaveCount(1);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(2);
});

test('copies a selected pair with its relation in one shared undo step', async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'Clipboard permissions are exercised in Chromium');
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	await joinFromLink(page, `/session/${room}`, 'Alice');
	await page.locator('[data-node-id="A"]').click();
	await page.locator('[data-node-id="B"]').click({ modifiers: ['Shift'] });
	await page.keyboard.press('ControlOrMeta+c');
	await page.keyboard.press('ControlOrMeta+v');
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id]')).toHaveCount(2);
	const copiedIds = await page
		.locator('[data-node-id][aria-pressed="true"]')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node-id')));
	expect(copiedIds).toHaveLength(2);
	const copiedRelation = page.locator('[data-relation-id]:not([data-relation-id="R"])');
	expect(copiedIds).toContain(await copiedRelation.getAttribute('data-edge-from'));
	expect(copiedIds).toContain(await copiedRelation.getAttribute('data-edge-to'));
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id]')).toHaveCount(1);
});

test('a second participant joins through the link, and the name is shared', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	await alice.goto(`/session/${room}`);
	const join = alice.getByRole('dialog', { name: 'Session collaborative' });
	await expect(join).toContainText('rejoindre une session partagée');
	await join.getByLabel('Ton nom').fill('Alice');
	await join.getByRole('button', { name: 'Rejoindre la session' }).click();
	await connected(alice);
	await expect(alice.locator('[data-node-id="A"]')).toContainText('Alpha');

	const bob = await browser.newPage();
	await bob.goto(`/session/${room}`);
	await bob
		.getByRole('dialog', { name: 'Session collaborative' })
		.getByLabel('Ton nom')
		.fill('Bob');
	await bob.getByRole('button', { name: 'Rejoindre la session' }).click();
	await connected(bob);

	await expect.poll(() => participants(alice)).toEqual(['Alice', 'Bob']);
	await expect.poll(() => participants(bob)).toEqual(['Bob', 'Alice']);

	await bob.getByRole('button', { name: 'Partager' }).click();
	const share = bob.getByRole('dialog', { name: 'Session collaborative' });
	await share.getByLabel('Ton nom').fill('Robert');
	await share.getByLabel('Ton nom').press('Enter');
	await expect.poll(() => participants(alice)).toEqual(['Alice', 'Robert']);

	await bob.reload();
	await expect(bob.getByRole('dialog')).toHaveCount(0);
	await connected(bob);
	await expect.poll(() => participants(alice)).toEqual(['Alice', 'Robert']);
	await alice.close();
	await bob.close();
});

async function joinFromLink(page: Page, link: string, name: string): Promise<void> {
	await page.goto(link);
	await page
		.getByRole('dialog', { name: 'Session collaborative' })
		.getByLabel('Ton nom')
		.fill(name);
	await page.getByRole('button', { name: 'Rejoindre la session' }).click();
	await connected(page);
	await page.locator('[data-node-id]').first().waitFor();
}

test('renaming the shared document renames it for every participant', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await joinFromLink(alice, `/session/${room}`, 'Alice');
	await joinFromLink(bob, `/session/${room}`, 'Bob');
	await expect(menuTrigger(bob)).toContainText('Deux boîtes');

	await menuTrigger(alice).click();
	await alice.getByRole('menuitem', { name: 'Renommer le document' }).click();
	await alice.getByRole('textbox', { name: 'Titre du document' }).fill('Plan partagé');
	await alice.getByRole('textbox', { name: 'Titre du document' }).press('Enter');
	await expect(menuTrigger(bob)).toContainText('Plan partagé');
	await expect(bob).toHaveTitle('Plan partagé — Session Sequit');
	await alice.close();
	await bob.close();
});

function canvasViewport(page: Page) {
	return page.getByRole('region', { name: 'Canvas viewport' });
}

test('cursors stay after a blur, off-screen cursors get an edge chip, and avatars follow', async ({
	browser,
}) => {
	const alice = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await alice.goto('/examples/ai-documentary-effort');
	await alice.locator('[data-node-id]').first().waitFor();
	await alice.getByRole('button', { name: 'Collaborer' }).click();
	await alice.getByLabel('Ton nom').fill('Alice');
	await alice.getByRole('button', { name: 'Démarrer la session' }).click();
	await alice.waitForURL(/\/session\//);
	await connected(alice);
	const bob = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await joinFromLink(bob, alice.url(), 'Bob');

	// Bob hovers a box both can see: Alice gets his cursor, then keeps it after he leaves.
	const shared = bob.locator('[data-node-id="ai-generation-orchestration"]');
	const box = await shared.boundingBox();
	if (!box) throw new Error('Box not laid out');
	await bob.mouse.move(box.x + 20, box.y + 20, { steps: 4 });
	const pointer = alice.locator('[data-remote-pointer][data-participant="Bob"]');
	await expect(pointer).toBeVisible();
	await bob.mouse.move(4, 4);
	await bob.evaluate(() => window.dispatchEvent(new Event('blur')));
	await bob.waitForTimeout(400);
	await expect(pointer).toBeVisible();

	// Bob scrolls far right: his cursor leaves Alice's viewport and becomes an edge chip.
	await canvasViewport(bob).evaluate((element) => {
		element.scrollBy({ left: 1800 });
	});
	await bob.mouse.move(600, 500, { steps: 4 });
	const chip = alice.getByRole('button', { name: 'Aller au curseur de Bob' });
	await expect(chip).toBeVisible();
	await expect(pointer).toHaveCount(0);
	await chip.click();
	await expect(pointer).toBeVisible();
	await expect(chip).toHaveCount(0);

	// Following Bob keeps Alice's viewport on him; her own scroll stops it.
	await alice.getByRole('button', { name: 'Suivre Bob' }).click();
	await expect(alice.getByRole('button', { name: 'Ne plus suivre Bob' })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await canvasViewport(bob).evaluate((element) => {
		element.scrollTo({ left: 0 });
	});
	await bob.mouse.move(300, 450, { steps: 4 });
	await expect
		.poll(() => canvasViewport(alice).evaluate((element) => element.scrollLeft))
		.toBeLessThan(400);
	await expect(pointer).toBeVisible();
	await canvasViewport(alice).hover();
	await alice.mouse.wheel(200, 0);
	await expect(alice.getByRole('button', { name: 'Suivre Bob' })).toHaveAttribute(
		'aria-pressed',
		'false',
	);
	await alice.close();
	await bob.close();
});

test('leaving keeps a local copy of the shared document', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	await page.goto(`/session/${room}`);
	await page
		.getByRole('dialog', { name: 'Session collaborative' })
		.getByLabel('Ton nom')
		.fill('Alice');
	await page.getByRole('button', { name: 'Rejoindre la session' }).click();
	await connected(page);

	await page.getByRole('button', { name: 'Partager' }).click();
	await page.getByRole('button', { name: 'Quitter la session' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(menuTrigger(page)).toContainText('Deux boîtes');
	await expect(page.locator('[data-node-id="A"]')).toContainText('Alpha');
	await expect(page.getByRole('button', { name: 'Collaborer' })).toBeVisible();
});

test('a malformed session link is refused', async ({ page }) => {
	const response = await page.goto('/session/Not%20A%20Room');
	expect(response?.status()).toBe(404);
});
