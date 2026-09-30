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
	await page.goto('/');
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
	await expect(page.getByRole('menuitem')).toHaveText(['Exporter…', 'Imprimer…']);
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
