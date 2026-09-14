import { expect, type Page, test } from '@playwright/test';
import * as Y from 'yjs';

import {
	decodeSessionMessage,
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

async function seedRoom(room: string, fixture: CollaborativeFixture): Promise<void> {
	const document = new Y.Doc();
	importLogicDocument(document, collaborativeFixture(fixture, room));
	const frame = encodeSessionMessage({
		type: SessionMessageKind.Initialize,
		id: 'fixture',
		update: Y.encodeStateAsUpdate(document),
	});
	document.destroy();
	const socket = new WebSocket(`ws://127.0.0.1:8788/collab/${room}`);
	socket.binaryType = 'arraybuffer';
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error('Room initialization timed out'));
		}, 10000);
		socket.addEventListener('open', () => {
			socket.send(frame);
		});
		socket.addEventListener('message', (event) => {
			if (!(event.data instanceof ArrayBuffer)) return;
			const message = decodeSessionMessage(new Uint8Array(event.data));
			if (message.type === SessionMessageKind.Commit) {
				clearTimeout(timer);
				socket.close();
				resolve();
			}
			if (message.type === SessionMessageKind.Reject) {
				clearTimeout(timer);
				socket.close();
				reject(new Error(message.message));
			}
		});
		socket.addEventListener('error', () => {
			clearTimeout(timer);
			reject(new Error('Room connection failed'));
		});
	});
}

async function edit(page: Page, label = 'Boîte A'): Promise<void> {
	const current = page.getByRole('dialog');
	if (await current.count())
		await current.getByRole('button', { name: 'Fermer', exact: true }).click();
	await page.getByRole('button', { name: `Modifier ${label}`, exact: true }).click();
}

async function closeEditor(page: Page): Promise<void> {
	await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).click();
}

test('Deux boîtes : modales Quill, présence et reprise avec deux navigateurs', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByLabel('Participants')).toContainText('Bob');
	await alice.locator('[data-node-id="A"]').click();
	await expect(bob.locator('[data-remote-selection="A"]')).toBeVisible();
	await expect(bob.locator('[data-remote-pointer]')).toBeVisible();
	await edit(alice);
	await edit(bob);
	const aliceText = alice.getByLabel('Contenu A', { exact: true });
	const bobText = bob.getByLabel('Contenu A', { exact: true });
	await aliceText.fill('Alpha modifié');
	await expect(bobText).toHaveText('Alpha modifié');
	await aliceText.press('Home');
	await aliceText.press('Shift+End');
	await expect(bob.locator('.remote-text-cursor[data-participant="Alice"]')).toBeVisible();
	await expect(bob.locator('.remote-text-selection').first()).toBeVisible();
	await alice.getByRole('button', { name: 'Gras', exact: true }).click();
	await expect(bobText.locator('strong')).toHaveText('Alpha modifié');
	await closeEditor(alice);
	await expect(bob.locator('.remote-text-cursor[data-participant="Alice"]')).toHaveCount(0);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await bob.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await expect(bob.locator('[data-remote-selection]')).toHaveCount(0);
	await edit(alice);
	await edit(bob, 'Boîte B');
	await aliceText.fill('Alpha hors ligne');
	await bob.getByLabel('Contenu B', { exact: true }).fill('Bravo hors ligne');
	await closeEditor(alice);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Reconnecter' }).click();
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await edit(alice, 'Boîte B');
	await edit(bob);
	await expect(alice.getByLabel('Contenu B', { exact: true })).toHaveText('Bravo hors ligne');
	await expect(bobText).toHaveText('Alpha hors ligne');
	await bob.reload();
	await edit(bob);
	await expect(bobText).toHaveText('Alpha hors ligne');
	await aliceContext.close();
	await bobContext.close();
});

test('Deux boîtes reliées : refus du cycle, refresh et toast, sans mutation chez Bob', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	await alice.getByLabel('Origine de la relation').selectOption('A');
	await alice.getByLabel('Destination de la relation').selectOption('B');
	const navigation = alice.waitForEvent('framenavigated', (frame) => frame === alice.mainFrame());
	await alice.getByRole('button', { name: 'Relier', exact: true }).click();
	await navigation;
	await expect(alice.getByRole('alert')).toBeVisible();
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	await expect(alice).not.toHaveURL(/collaboration-error/);
	await expect(alice.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await aliceContext.close();
	await bobContext.close();
});

test('Deux boîtes : création de relation puis suppression de B propagées au canvas', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	await alice.getByLabel('Origine de la relation').selectOption('B');
	await alice.getByLabel('Destination de la relation').selectOption('A');
	await alice.getByRole('button', { name: 'Relier', exact: true }).click();
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toContainText('B → A');
	await expect(bob.locator('[data-relation-id]')).toHaveCount(1);
	await edit(alice, 'Boîte B');
	await alice.getByRole('button', { name: 'Supprimer B', exact: true }).click();
	await expect(bob.getByLabel('Contenu B', { exact: true })).toHaveCount(0);
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toHaveCount(0);
	await expect(bob.locator('[data-node-id="B"]')).toHaveCount(0);
	await expect(bob.getByRole('button', { name: 'Modifier Boîte A', exact: true })).toBeVisible();
	await aliceContext.close();
	await bobContext.close();
});

test('Groupe ouvert : repli partagé, dissolution et nouvelle disposition', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.OpenGroup);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	await edit(alice, 'Groupe G');
	await edit(bob, 'Groupe G');
	await alice.getByRole('button', { name: 'Replier G', exact: true }).click();
	await expect(bob.getByLabel('État de G', { exact: true })).toHaveText('closed');
	await expect(bob.locator('[data-node-id="A"]')).toHaveCount(0);
	await expect(bob.getByRole('button', { name: 'Modifier Boîte A', exact: true })).toHaveCount(1);
	await alice.getByRole('button', { name: 'Dissoudre G', exact: true }).click();
	await expect(bob.getByLabel('État de G', { exact: true })).toHaveCount(0);
	await expect(bob.locator('[data-node-id="A"]')).toBeVisible();
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await alice.getByLabel('Disposition', { exact: true }).selectOption('left-to-right/left');
	await expect(bob.getByLabel('Layout partagé')).toHaveText('left-to-right / left');
	await alice.getByLabel('Éléments à regrouper').selectOption(['A', 'B']);
	await alice.getByRole('button', { name: 'Regrouper', exact: true }).click();
	await expect(bob.getByRole('button', { name: /^Modifier Groupe / })).toHaveCount(1);
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await aliceContext.close();
	await bobContext.close();
});

test('Deux boîtes : insertions concurrentes, curseur stable et autres champs partagés', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await edit(alice);
	await edit(bob);
	const aliceText = alice.getByLabel('Contenu A', { exact: true });
	const bobText = bob.getByLabel('Contenu A', { exact: true });
	await bobText.focus();
	await bobText.press('Home');
	await bobText.press('ArrowRight');
	await bobText.press('ArrowRight');
	await aliceText.focus();
	await aliceText.press('Home');
	await aliceText.pressSequentially('X');
	await expect(bobText).toHaveText('XAlpha');
	await bobText.pressSequentially('|');
	await expect(aliceText).toHaveText('XAl|pha');
	await closeEditor(alice);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await bob.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await edit(alice);
	await edit(bob);
	await aliceText.press('End');
	await aliceText.pressSequentially(' fin');
	await bobText.press('Home');
	await bobText.pressSequentially('Début ');
	await closeEditor(alice);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Reconnecter' }).click();
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await edit(alice);
	await edit(bob);
	await expect(aliceText).toHaveText('Début XAl|pha fin');
	await expect(bobText).toHaveText('Début XAl|pha fin');
	await alice.getByLabel('Couleur de A', { exact: true }).fill('#aabbcc');
	await alice.getByLabel('Couleur de A', { exact: true }).press('Tab');
	await expect(bob.getByLabel('Couleur de A', { exact: true })).toHaveValue('#aabbcc');
	await edit(alice, 'Titre du document');
	await edit(bob, 'Titre du document');
	await alice
		.getByRole('textbox', { name: 'Titre du document', exact: true })
		.fill('Document commun');
	await expect(bob.getByRole('textbox', { name: 'Titre du document', exact: true })).toHaveText(
		'Document commun',
	);
	await edit(alice, 'Nature N');
	await edit(bob, 'Nature N');
	await bob.getByLabel('Libellé de la nature N', { exact: true }).fill('Décision');
	await expect(alice.getByLabel('Libellé de la nature N', { exact: true })).toHaveText('Décision');
	await aliceContext.close();
	await bobContext.close();
});
