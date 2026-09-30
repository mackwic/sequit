import { expect, type Locator, test } from '@playwright/test';

import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

const importedDescription = [
	'![Un diagramme](https://example.test/diagram.png "Titre")',
	'```typescript\nconst answer = 42;\n```',
	'| A | B |\n|---|---|\n| un | deux |',
	'- [x] Terminé\n- [ ] À faire',
	'Conclusion',
].join('\n\n');

async function expectSource(editor: Locator, markdown: string): Promise<void> {
	// Quill stores each source line in its own paragraph; textContent drops those separators,
	// whereas innerText adds browser-dependent spacing. Rebuild only the line boundaries.
	await expect
		.poll(() =>
			editor.evaluate((element) =>
				Array.from(element.children, (line) => line.textContent).join('\n'),
			),
		)
		.toBe(markdown);
}

test('description editing preserves imported structures across peers and reload', async ({
	browser,
}) => {
	const room = `editor-${crypto.randomUUID()}`;
	const fixture = collaborativeFixture(CollaborativeFixture.TwoBoxes, room);
	await seedRoom(room, CollaborativeFixture.TwoBoxes, {
		...fixture,
		nodes: fixture.nodes.map((node) => {
			if (node.id === 'A') return { ...node, description: importedDescription };
			return node;
		}),
	});
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();
	await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
	await alice.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
	await bob.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
	const aliceDescription = alice.getByRole('textbox', {
		name: 'Description de A',
		exact: true,
	});
	const bobDescription = bob.getByRole('textbox', {
		name: 'Description de A',
		exact: true,
	});
	await expectSource(aliceDescription, importedDescription);
	await expect(alice.locator('[data-text-field="description"]')).toContainText('texte source');
	await aliceDescription.focus();
	await aliceDescription.evaluate((element) => {
		const end = element.lastElementChild?.lastChild;
		const selection = window.getSelection();
		if (end?.nodeType !== Node.TEXT_NODE || selection === null)
			throw new Error('Expected the final source text node');
		selection.collapse(end, end.textContent?.length ?? 0);
	});
	await aliceDescription.press('!');
	await expectSource(bobDescription, `${importedDescription}!`);
	await expect(bob.getByRole('textbox', { name: 'Contenu A', exact: true })).toHaveText('Alpha');
	await bob.reload();
	await bob.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
	await expectSource(bobDescription, `${importedDescription}!`);
	await aliceContext.close();
	await bobContext.close();
});

test('node body offers inline emphasis while its description has separate rich editing', async ({
	page,
}) => {
	const room = `editor-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	await page.goto(`/atelier/collaboration?room=${room}&name=Alice`);
	await page.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
	const body = page.locator('[data-text-field="markdown"]');
	const description = page.locator('[data-text-field="description"]');
	await expect(body.getByRole('button', { name: 'Gras', exact: true })).toBeVisible();
	await expect(body.getByRole('button', { name: 'Italique', exact: true })).toBeVisible();
	await expect(body.getByRole('button', { name: 'Souligné', exact: true })).toBeVisible();
	await expect(body.getByRole('button', { name: 'Lien', exact: true })).toHaveCount(0);
	await expect(description.getByRole('button', { name: 'Lien', exact: true })).toBeVisible();
	const content = body.getByRole('textbox');
	await content.press('ControlOrMeta+a');
	await body.getByRole('button', { name: 'Souligné', exact: true }).click();
	await expect(content.locator('u')).toHaveText('Alpha');
	const details = description.getByRole('textbox');
	await details.fill('Des précisions');
	await expect(details).toHaveText('Des précisions');
	await details.press('ControlOrMeta+a');
	await description.getByRole('button', { name: 'Gras', exact: true }).click();
	await expect(details.locator('strong')).toHaveText('Des précisions');
	await details.press('Escape');
	await expect(page.locator('[data-node-id="A"]')).toHaveAccessibleName('Action Alpha');
	await page.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
	await expect(content.locator('u')).toHaveText('Alpha');
	await expect(details.locator('strong')).toHaveText('Des précisions');
});
