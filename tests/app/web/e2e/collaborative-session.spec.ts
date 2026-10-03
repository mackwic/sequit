import { setTimeout as delay } from 'node:timers/promises';

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

async function closeEditor(page: Page, name?: string): Promise<void> {
	let dialog = page.getByRole('dialog');
	if (name !== undefined) dialog = page.getByRole('dialog', { name, exact: true });
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
}

async function edit(page: Page, label = 'Boîte A'): Promise<void> {
	const canvasEditor = page.getByRole('dialog', { name: 'Propriétés de la boîte', exact: true });
	if (await canvasEditor.count()) await closeEditor(page, 'Propriétés de la boîte');
	else if (await page.getByRole('dialog').count()) await closeEditor(page);
	await page.getByRole('button', { name: `Modifier ${label}`, exact: true }).click();
}

/** The box being typed in place: it shows, has the focus, and gives the id the box will have. */
async function typedBox(page: Page) {
	const draft = page.locator('[data-node-draft]');
	const content = draft.getByRole('textbox', { name: 'Contenu de la nouvelle boîte' });
	await expect(content).toBeFocused();
	const id = await draft.getAttribute('data-node-draft');
	if (id === null || id === '') throw new Error('The box being typed has no id');
	return { content, id };
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
				if (message.type === Message.Reject) reject(new Error(message.reason.code));
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
	await expect(aliceText).toHaveAttribute('contenteditable', 'true');
	await expect(bob.getByLabel('Contenu B', { exact: true })).toHaveAttribute(
		'contenteditable',
		'true',
	);
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

test('a text buffered during reconnect reaches the other browser and survives a fresh Worker join', async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	let holdSync = false;
	let forwardedText = 0;
	const withheld: (() => void)[] = [];
	await aliceContext.routeWebSocket(`**/collab/${room}`, (route) => {
		const server = route.connectToServer();
		route.onMessage((message) => {
			if (typeof message !== 'string') {
				const frame = decodeSessionMessage(new Uint8Array(message));
				if (frame.type === Message.Change && 'update' in frame) forwardedText++;
			}
			server.send(message);
		});
		server.onMessage((message) => {
			if (
				holdSync &&
				typeof message !== 'string' &&
				decodeSessionMessage(new Uint8Array(message)).type === Message.Sync
			) {
				withheld.push(() => {
					route.send(message);
				});
				return;
			}
			route.send(message);
		});
	});
	try {
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();
		await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
		await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
		await expect(alice.getByRole('status', { name: 'Connexion' })).toHaveText('Connecté');
		await edit(bob);
		const bobText = bob.getByLabel('Contenu A', { exact: true });
		holdSync = true;
		await alice.getByRole('button', { name: 'Mettre hors ligne' }).click();
		await alice.getByRole('button', { name: 'Reconnecter' }).click();
		await expect.poll(() => withheld.length).toBeGreaterThan(0);
		await expect(alice.getByRole('status', { name: 'Connexion' })).toContainText('Synchronisation');
		await edit(alice);
		const aliceText = alice.getByLabel('Contenu A', { exact: true });
		await aliceText.fill('Première frappe pendant la reprise');
		await delay(100);
		await expect(bobText).toHaveText('Alpha');
		expect(forwardedText).toBe(0);
		holdSync = false;
		for (const release of withheld.splice(0)) release();
		await expect.poll(() => forwardedText).toBeGreaterThan(0);
		await aliceText.fill('Seconde frappe après la réponse');
		await expect(bobText).toHaveText('Seconde frappe après la réponse');
		await bob.reload();
		await edit(bob);
		await expect(bobText).toHaveText('Seconde frappe après la réponse');
	} finally {
		await Promise.allSettled([aliceContext.close(), bobContext.close()]);
	}
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
	await expect(aliceText).toHaveAttribute('contenteditable', 'true');
	await expect(bobText).toHaveAttribute('contenteditable', 'true');
	await aliceText.focus();
	await aliceText.evaluate((element) => {
		const end = element.lastElementChild?.lastChild;
		const selection = window.getSelection();
		if (end?.nodeType !== Node.TEXT_NODE || selection === null)
			throw new Error('Expected the final text node');
		selection.collapse(end, end.textContent?.length ?? 0);
	});
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
	await expect(alice.locator('[data-drop-label]')).toContainText('Relier à « ');
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
	// The cycle is named before letting go; releasing proposes nothing.
	await expect(b).toHaveAttribute('data-refused-target', 'true');
	await expect(alice.locator('[data-drop-label]')).toHaveText(
		'Relation impossible : elle créerait un cycle',
	);
	await alice.mouse.up();
	await expect(alice.locator('[data-drop-label]')).toHaveCount(0);
	await expect(alice.getByRole('alert')).toHaveCount(0);
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
	const typed = await typedBox(alice);
	await typed.content.fill('Membre partagé');
	await alice.keyboard.press('ControlOrMeta+Enter');
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

test('Grouping from the canvas names the group live, folds and dissolves it across browsers', async ({
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
	await alice.locator('[data-node-id="B"]').click({ modifiers: ['Shift'] });
	await alice.getByRole('button', { name: 'Grouper 2 nœuds', exact: true }).click();
	const naming = alice.getByRole('dialog', { name: 'Nommer le groupe' });
	await expect(naming).toBeVisible();
	const title = naming.getByLabel('Titre du groupe', { exact: true });
	await expect(title).toHaveText('Groupe');
	await title.fill('Pistes');
	const group = bob.locator('[data-group-id]');
	await expect(group).toContainText('Pistes');
	await naming.getByLabel('Couleur personnalisée').fill('#2563eb');
	await naming.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(naming).toHaveCount(0);
	await expect(group).toHaveAttribute('data-group-color', '#2563eb');

	await alice.getByRole('button', { name: 'Replier le groupe Pistes', exact: true }).click();
	await expect(bob.locator('[data-node-id]')).toHaveCount(0);
	await expect(group).toHaveCount(1);
	await bob.getByRole('button', { name: 'Déplier le groupe Pistes', exact: true }).click();
	await expect(alice.locator('[data-node-id]')).toHaveCount(2);

	await alice.locator('[data-group-header]').dblclick();
	const editing = alice.getByRole('dialog', { name: 'Propriétés du groupe' });
	await editing.getByRole('button', { name: 'Dissoudre', exact: true }).click();
	await expect(editing).toHaveCount(0);
	await expect(group).toHaveCount(0);
	await expect(bob.locator('[data-node-id]')).toHaveCount(2);
	await alice.close();
	await bob.close();
});

test('Inserting a junction with J replaces the relation for every collaborator', async ({
	browser,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.OpenGroup);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);
	const relation = alice.locator('[data-relation-id="R"]');
	await relation.focus();
	await relation.press('Space');
	await relation.press('j');
	const dialog = alice.getByRole('dialog', { name: 'Opérateur de la jonction' });
	await expect(dialog).toBeVisible();
	const junction = bob.locator('[data-junction-id]');
	await expect(junction).toHaveAttribute('data-junction-group-id', 'G');
	await expect(bob.locator('[data-relation-id="R"]')).toHaveCount(0);
	await expect(bob.locator('[data-relation-id]')).toHaveCount(2);
	await dialog.getByRole('radio', { name: 'ET' }).check();
	await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(junction.locator('[data-junction-symbol="and"]')).toHaveCount(1);
	await alice.close();
	await bob.close();
});

test('Keyboard child and chained child creation are proposed across collaborators', async ({
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
	await alice.keyboard.press('c');
	const child = await typedBox(alice);
	await expect(bob.locator(`[data-node-id="${child.id}"]`)).toHaveCount(0);
	await child.content.fill('Premier enfant partagé');
	await alice.keyboard.press('ControlOrMeta+Shift+Enter');
	const grandchild = await typedBox(alice);
	await expect(bob.locator(`[data-node-id="${child.id}"]`)).toContainText('Premier enfant partagé');
	await expect(
		bob.locator(`[data-relation-id][data-edge-from="${child.id}"][data-edge-to="A"]`),
	).toHaveCount(1);
	await grandchild.content.fill('Petit-enfant partagé');
	await alice.keyboard.press('ControlOrMeta+Enter');
	await expect(bob.locator('[data-node-id]')).toHaveCount(4);
	await expect(alice.locator('[data-node-id]')).toHaveCount(4);
	await expect(alice.locator(`[data-node-id="${grandchild.id}"]`)).toBeFocused();
	await expect(
		bob.locator(
			`[data-relation-id][data-edge-from="${grandchild.id}"][data-edge-to="${child.id}"]`,
		),
	).toHaveCount(1);
	await expect(bob.locator(`[data-node-id="${grandchild.id}"]`)).toContainText(
		'Petit-enfant partagé',
	);
	// Typed in place first, then Ctrl/Cmd+E opens the dialog for the description.
	await alice.locator(`[data-node-id="${grandchild.id}"]`).dblclick();
	await expect(
		alice
			.locator(`[data-node-draft="${grandchild.id}"]`)
			.getByRole('textbox', { name: 'Contenu de la boîte' }),
	).toBeFocused();
	await alice.keyboard.press('ControlOrMeta+e');
	const editor = alice.getByRole('dialog', { name: 'Propriétés de la boîte', exact: true });
	await expect(editor).toBeVisible();
	await expect(alice.getByRole('textbox', { name: `Texte de ${grandchild.id}` })).toBeFocused();
	const description = editor.getByRole('textbox', {
		name: `Description de ${grandchild.id}`,
		exact: true,
	});
	await expect(description).toBeVisible();
	await description.fill('Description partagée');
	await bob.getByRole('button', { name: `Modifier Boîte ${grandchild.id}`, exact: true }).click();
	await expect(
		bob.getByRole('textbox', { name: `Description de ${grandchild.id}`, exact: true }),
	).toHaveText('Description partagée');
	await closeEditor(bob);
	await closeEditor(alice, 'Propriétés de la boîte');
	await alice.close();
	await bob.close();
});

test('the canvas action button types a shared root box', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);

	await alice.getByRole('button', { name: 'Nouvelle boîte', exact: true }).click();
	const typed = await typedBox(alice);
	await typed.content.fill('Racine partagée');
	await alice.keyboard.press('ControlOrMeta+Enter');
	await expect(alice.locator('[data-node-id]')).toHaveCount(3);
	await expect(bob.locator('[data-node-id]')).toHaveCount(3);
	await expect(alice.locator('[data-relation-id]')).toHaveCount(0);
	await expect(bob.locator('[data-relation-id]')).toHaveCount(0);
	await expect(bob.locator('[data-node-id]').filter({ hasText: 'Racine partagée' })).toBeVisible();
	await alice.close();
	await bob.close();
});

test('a box typed in place shares its text as it is typed', async ({ browser }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const alice = await browser.newPage();
	const bob = await browser.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await expect(alice.getByRole('status', { name: 'Connexion', exact: true })).toHaveText(
		'Connecté',
	);

	await alice.locator('[data-node-id="A"]').dblclick();
	const content = alice
		.locator('[data-node-draft="A"]')
		.getByRole('textbox', { name: 'Contenu de la boîte' });
	await expect(content).toBeFocused();
	await expect(alice.getByRole('dialog')).toHaveCount(0);
	await content.fill('Alpha tapé en place');
	// Bob reads it before Alice leaves the box, as with the dialog.
	await expect(bob.locator('[data-node-id="A"]')).toContainText('Alpha tapé en place');
	await alice.keyboard.press('ControlOrMeta+Enter');
	await expect(alice.locator('[data-node-draft]')).toHaveCount(0);
	await expect(alice.locator('[data-node-id="A"]')).toBeFocused();
	await alice.close();
	await bob.close();
});

test('the canvas box editor keeps its draft readable after remote deletion', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	await page.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	const node = page.locator('[data-node-id="A"]');
	await node.click();
	await page.keyboard.press('e');
	const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('textbox', { name: 'Texte de A', exact: true })).toBeFocused();

	await externalCommands(room, [{ op: Op.Delete, target: { kind: Kind.Node, id: 'A' } }]);
	await expect(node).toHaveCount(0);
	const retainedContent = dialog.getByRole('textbox', { name: 'Texte de A', exact: true });
	await expect(retainedContent).toHaveValue('Alpha');
	await expect(retainedContent).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Enregistrer', exact: true })).toBeDisabled();
	await closeEditor(page, 'Propriétés de la boîte');
});

test('Escape cancels a keyboard creation without creating a shared node or relation', async ({
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
	await alice.keyboard.press('c');
	const typed = await typedBox(alice);
	await typed.content.fill('Annulé');
	await alice.keyboard.press('Escape');
	await expect(alice.locator('[data-node-draft]')).toHaveCount(0);
	await expect(alice.locator('[data-node-id]')).toHaveCount(2);
	await expect(bob.locator('[data-node-id]')).toHaveCount(2);
	await expect(alice.locator('[data-relation-id][data-edge-to="A"]')).toHaveCount(0);
	await expect(bob.locator('[data-relation-id][data-edge-to="A"]')).toHaveCount(0);
	await alice.close();
	await bob.close();
});
