import { expect, type Page, test } from '@playwright/test';

import {
	decodeSessionMessage,
	encodeSessionMessage,
	SessionMessageKind as Message,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import {
	SharedCommandKind as Op,
	type SharedDocumentCommand,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

async function edit(page: Page, label = 'Boîte A'): Promise<void> {
	const current = page.getByRole('dialog');
	if (await current.count())
		await current.getByRole('button', { name: 'Fermer', exact: true }).click();
	await page.getByRole('button', { name: `Modifier ${label}`, exact: true }).click();
}

async function closeEditor(page: Page): Promise<void> {
	await page.getByRole('dialog').getByRole('button', { name: 'Fermer', exact: true }).click();
}

async function externalCommands(
	room: string,
	commands: readonly SharedDocumentCommand[],
): Promise<void> {
	const proposal = `replace-${crypto.randomUUID()}`;
	const frame = encodeSessionMessage({
		type: Message.Change,
		id: proposal,
		sessionId: `peer-${crypto.randomUUID()}`,
		sequence: 1,
		commands,
	});
	const peer = new WebSocket(`ws://127.0.0.1:8788/collab/${room}`);
	peer.binaryType = 'arraybuffer';
	try {
		await new Promise<void>((resolve, reject) => {
			peer.addEventListener('open', () => {
				peer.send(frame);
			});
			peer.addEventListener('message', (event) => {
				if (!(event.data instanceof ArrayBuffer)) return;
				const message = decodeSessionMessage(new Uint8Array(event.data));
				if (message.type === Message.Commit && message.id === proposal) resolve();
				if (message.type === Message.Reject) reject(new Error(message.message));
			});
			peer.addEventListener('error', () => {
				reject(new Error('Peer WebSocket failed'));
			});
		});
	} finally {
		peer.close();
	}
}

test('A recreated box remounts its editor before typing can alter the new incarnation', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	await page.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await edit(page);
	const field = page.getByLabel('Contenu A', { exact: true });
	await expect(field).toHaveText('Alpha');
	const previous = await field.elementHandle();
	await externalCommands(room, [
		{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } },
		{
			op: Op.Create,
			target: { kind: Kind.Node, id: 'A' },
			properties: { natureId: 'N', markdown: 'Fresh incarnation' },
		},
	]);
	await expect(field).toHaveText('Fresh incarnation');
	expect(await field.elementHandle()).not.toBe(previous);
	await field.fill('Edited fresh incarnation');
	await expect(field).toHaveText('Edited fresh incarnation');
	const observer = await page.context().newPage();
	await observer.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await edit(observer);
	await expect(observer.getByLabel('Contenu A', { exact: true })).toHaveText(
		'Edited fresh incarnation',
	);
	await observer.close();
	await page.reload();
	await edit(page);
	await expect(field).toHaveText('Edited fresh incarnation');
});

test('A recreated group remounts the sidebar label editor and persists its new text', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.OpenGroup);
	await page.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await edit(page, 'Groupe G');
	const field = page.getByLabel('Libellé du groupe G', { exact: true });
	await expect(field).toHaveText('Groupe');
	const previous = await field.elementHandle();
	await externalCommands(room, [
		{ op: Op.Ungroup, id: 'G' },
		{ op: Op.Group, id: 'G', label: 'Groupe recréé', members: ['A', 'B'] },
	]);
	await expect(field).toHaveText('Groupe recréé');
	expect(await field.elementHandle()).not.toBe(previous);
	await field.fill('Libellé modifié');
	const observer = await page.context().newPage();
	await observer.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await edit(observer, 'Groupe G');
	await expect(observer.getByLabel('Libellé du groupe G', { exact: true })).toHaveText(
		'Libellé modifié',
	);
	await observer.close();
	await page.reload();
	await edit(page, 'Groupe G');
	await expect(field).toHaveText('Libellé modifié');
});

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
	await alice
		.locator('[data-text-field="markdown"]')
		.getByRole('button', { name: 'Gras', exact: true })
		.click();
	await expect(bobText.locator('strong')).toHaveText('Alpha modifié');
	await closeEditor(alice);
	await expect(bob.locator('.remote-text-cursor[data-participant="Alice"]')).toHaveCount(0);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await bob.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await expect(bob.locator('[data-remote-selection]')).toHaveCount(0);
	await edit(alice);
	await edit(bob, 'Boîte B');
	await expect(aliceText).toHaveAttribute('contenteditable', 'false');
	await expect(bob.getByLabel('Contenu B', { exact: true })).toHaveAttribute(
		'contenteditable',
		'false',
	);
	await closeEditor(alice);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Reconnecter' }).click();
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await expect(alice.getByRole('status', { name: 'Connexion' })).toHaveText('Connecté');
	await expect(bob.getByRole('status', { name: 'Connexion' })).toHaveText('Connecté');
	await edit(alice);
	await edit(bob, 'Boîte B');
	await aliceText.fill('Alpha après reprise');
	await bob.getByLabel('Contenu B', { exact: true }).fill('Bravo après reprise');
	await expect(aliceText).toHaveText('Alpha après reprise');
	await closeEditor(alice);
	await closeEditor(bob);
	await bob.reload();
	await edit(bob);
	await expect(bobText).toHaveText('Alpha après reprise');
	await aliceContext.close();
	await bobContext.close();
});

test('Deux boîtes reliées : refus du cycle, toast sans refresh et édition suivante partagée', async ({
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
	const navigations: string[] = [];
	alice.on('framenavigated', (frame) => {
		if (frame === alice.mainFrame()) navigations.push(frame.url());
	});
	await alice.getByRole('button', { name: 'Relier', exact: true }).click();
	await expect(alice.getByRole('status').filter({ hasText: /Action .* refusée/ })).toBeVisible();
	expect(navigations).toEqual([]);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	await expect(alice).not.toHaveURL(/collaboration-error/);
	await expect(alice.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await expect(bob.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await edit(alice);
	await edit(bob);
	await alice.getByLabel('Contenu A', { exact: true }).fill('Après le refus');
	await expect(bob.getByLabel('Contenu A', { exact: true })).toHaveText('Après le refus');
	expect(navigations).toEqual([]);
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
	await expect(bob.getByRole('button', { name: 'Modifier Boîte A', exact: true })).toHaveCount(0);
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
	await expect(aliceText).toHaveAttribute('contenteditable', 'false');
	await expect(bobText).toHaveAttribute('contenteditable', 'false');
	await closeEditor(alice);
	await closeEditor(bob);
	await alice.getByRole('button', { name: 'Reconnecter' }).click();
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await expect(alice.getByRole('status', { name: 'Connexion' })).toHaveText('Connecté');
	await expect(bob.getByRole('status', { name: 'Connexion' })).toHaveText('Connecté');
	await edit(alice);
	await edit(bob);
	await aliceText.fill('XAlpha fin');
	await expect(bobText).toHaveText('XAlpha fin');
	await bobText.press('Home');
	await bobText.pressSequentially('Début ');
	await expect(aliceText).toHaveText('Début XAlpha fin');
	await expect(bobText).toHaveText('Début XAlpha fin');
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

test('Canvas gestures: ghost connection, cancellation, cycle rejection and deletion propagate', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	const a = alice.locator('[data-node-id="A"]');
	const b = alice.locator('[data-node-id="B"]');
	await expect(a).toBeVisible();
	await expect(b).toBeVisible();
	async function drag(from: string, to: string) {
		const originNode = alice.locator(`[data-node-id="${from}"]`);
		const destinationNode = alice.locator(`[data-node-id="${to}"]`);
		await Promise.all(
			[originNode, destinationNode].map((node) =>
				node.evaluate(async (element) => {
					await Promise.allSettled(
						element.getAnimations({ subtree: true }).map((animation) => animation.finished),
					);
				}),
			),
		);
		const origin = await originNode.boundingBox();
		const destination = await destinationNode.boundingBox();
		if (!origin || !destination) throw new Error('Missing node geometry');
		await alice.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
		await alice.mouse.down();
		await alice.mouse.move(
			destination.x + destination.width / 2,
			destination.y + destination.height / 2,
			{ steps: 8 },
		);
	}
	await drag('B', 'A');
	await expect(alice.locator('.ghost')).toBeVisible();
	await expect(a).toHaveAttribute('data-connection-target', 'true');
	await alice.keyboard.press('Escape');
	await alice.mouse.up();
	await expect(alice.locator('.ghost')).toHaveCount(0);
	await expect(alice.locator('[data-relation-id]')).toHaveCount(0);
	await drag('B', 'A');
	await alice.mouse.up();
	await expect(bob.locator('[data-relation-id]')).toHaveCount(1);
	await expect(alice.locator('[data-relation-id]')).toHaveCount(1);
	await drag('A', 'B');
	await expect(alice.locator('.ghost')).toBeVisible();
	await expect(b).toHaveAttribute('data-connection-target', 'true');
	await alice.mouse.up();
	await expect(alice.getByRole('alert')).toBeVisible();
	await expect(alice.locator('[data-relation-id]')).toHaveCount(1);
	await b.click();
	const relation = alice.locator('[data-relation-id]');
	await relation.press('Space');
	await relation.press('Backspace');
	await expect(bob.locator('[data-node-id="B"]')).toHaveCount(0);
	await expect(bob.locator('[data-relation-id]')).toHaveCount(0);
	await alice.close();
	await bob.close();
});

test('Group background creation shares membership with another browser', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.OpenGroup);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	const group = alice.locator('[data-group-id="G"]');
	await expect(group).toBeVisible();
	await group.dblclick({ position: { x: 8, y: 48 } });
	const dialog = alice.getByRole('dialog', { name: 'Nouvelle boîte' });
	await dialog.getByLabel('Contenu').fill('Membre partagé');
	await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
	const member = bob.locator('[data-node-id]').filter({ hasText: 'Membre partagé' });
	await expect(member).toBeVisible();
	await edit(alice, 'Groupe G');
	await alice.getByRole('button', { name: 'Replier G', exact: true }).click();
	await expect(member).toHaveCount(0);
	await alice.getByRole('button', { name: 'Déplier G', exact: true }).click();
	await expect(member).toBeVisible();
	await alice.close();
	await bob.close();
});

test('Keyboard child and sibling creation hand the collaborative editor to each new node', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);

	await alice.locator('[data-node-id="A"]').click();
	await alice.keyboard.press('Control+Enter');
	await expect(bob.locator('[data-node-id]')).toHaveCount(3);
	const firstRelation = bob.locator('[data-relation-id][data-edge-to="A"]');
	await expect(firstRelation).toHaveCount(1);
	const firstChildId = await firstRelation.getAttribute('data-edge-from');
	if (firstChildId === null || firstChildId === '')
		throw new Error('Collaborative child relation has no origin');
	const firstEditor = alice.getByRole('textbox', { name: `Texte de ${firstChildId}` });
	await expect(firstEditor).toBeFocused();
	await firstEditor.fill('Premier enfant partagé');
	await alice.keyboard.press('Control+Shift+Enter');

	await expect(bob.locator('[data-node-id]')).toHaveCount(4);
	await expect(bob.locator(`[data-node-id="${firstChildId}"]`)).toContainText(
		'Premier enfant partagé',
	);
	const siblingRelations = bob.locator(`[data-relation-id][data-edge-to="A"]`);
	await expect(siblingRelations).toHaveCount(2);
	const origins = await siblingRelations.evaluateAll((relations) =>
		relations.map((relation) => relation.getAttribute('data-edge-from')),
	);
	const siblingId = origins.find((id) => id !== firstChildId);
	if (siblingId === null || siblingId === undefined || siblingId === '')
		throw new Error('Collaborative sibling relation has no distinct origin');
	const siblingEditor = alice.getByRole('textbox', { name: `Texte de ${siblingId}` });
	await expect(siblingEditor).toBeFocused();
	await siblingEditor.fill('Sibling saved and closed');
	await alice.keyboard.press('Shift+Enter');
	await expect(alice.getByRole('dialog', { name: `Boîte ${siblingId}` })).toHaveCount(0);
	await expect(bob.locator(`[data-node-id="${siblingId}"]`)).toContainText(
		'Sibling saved and closed',
	);
	await alice.close();
	await bob.close();
});

test('Escape rolls back a keyboard-created node for every collaborator', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);

	await alice.locator('[data-node-id="A"]').click();
	await alice.keyboard.press('Control+Enter');
	await expect(bob.locator('[data-node-id]')).toHaveCount(3);
	const createdId = await bob
		.locator('[data-relation-id][data-edge-to="A"]')
		.getAttribute('data-edge-from');
	if (createdId === null || createdId === '') throw new Error('Created node editor has no node id');

	await alice.keyboard.press('Escape');
	await expect(alice.locator(`[data-node-id="${createdId}"]`)).toHaveCount(0);
	await expect(bob.locator(`[data-node-id="${createdId}"]`)).toHaveCount(0);
	await alice.close();
	await bob.close();
});
