import { expect, test } from '@playwright/test';

import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('a shared document remains readable on a phone without page overflow', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	await page.goto(`/atelier/collaboration?room=${room}&name=Lecture`);
	await expect(page.locator('[data-node-id="A"]')).toBeVisible();
	await expect(page.locator('[data-relation-id]')).toHaveCount(1);
	await expect(page.locator('[data-node-id="A"]')).toContainText('Alpha');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	const viewport = await page.locator('[data-canvas-viewport]').boundingBox();
	expect(viewport?.width).toBeGreaterThan(300);
	await page.locator('[data-node-id="A"]').tap();
	await expect(page.locator('[data-node-id="A"]')).toHaveAttribute('aria-pressed', 'true');
});

const ONE_BOX = `persistenceFormat = 2
[document]
id = "telephone"
title = "Téléphone"
[layout]
direction = "top-to-bottom"
bias = "top"
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

test('a phone starts the canvas smaller, keeps bars on screen and gives dialogs the whole screen', async ({
	page,
}) => {
	await page.goto('/');
	await page.locator('header button[aria-haspopup="menu"]').tap();
	await page.getByRole('menuitem', { name: 'Ouvrir…' }).tap();
	await page
		.getByRole('dialog', { name: 'Ouvrir un document' })
		.getByLabel('Fichier Sequit (.sequit.toml)')
		.setInputFiles({
			name: 'telephone.sequit.toml',
			mimeType: 'text/plain',
			buffer: Buffer.from(ONE_BOX),
		});
	const node = page.locator('[data-node-id="seul"]');
	await expect(node).toContainText('Une seule boîte');
	await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('70%');
	const screen = page.viewportSize();
	if (!screen) throw new Error('Expected a phone viewport');

	await node.tap();
	const actions = page.getByRole('group', { name: 'Actions du nœud' });
	const bar = await actions.boundingBox();
	expect(bar?.x).toBeGreaterThanOrEqual(0);
	expect((bar?.x ?? 0) + (bar?.width ?? Infinity)).toBeLessThanOrEqual(screen.width);
	await expect(actions.locator('kbd').first()).toBeHidden();

	await actions.getByRole('button', { name: /^Propriétés/ }).tap();
	const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
	await expect(dialog).toBeVisible();
	expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, ...screen });
	// iOS Safari zooms the page into a field under 16px: none may be smaller.
	await expect(dialog.locator('[contenteditable="true"]').first()).toBeVisible();
	const fieldSizes = await dialog
		.locator('select, input:not([type="radio"]), [contenteditable="true"]')
		.evaluateAll((fields) => fields.map((field) => getComputedStyle(field).fontSize));
	expect(fieldSizes.filter((size) => Number.parseFloat(size) < 16)).toEqual([]);
});
