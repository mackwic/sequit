import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';
const scenarios: readonly [string, number][] = [
	['SC-BOX-CREATE', 3],
	['SC-NAV-EXPLORE', 2],
	['SC-SEL-COMPOSE', 2],
	['SC-CTX-ACTIONS', 3],
	['SC-REL-CONNECT', 2],
	['SC-REL-JUNCTION', 2],
	['SC-GRP-ORGANIZE', 2],
	['SC-NAT-MANAGE', 2],
	['SC-NAT-STYLE', 2],
	['SC-LAY-ARRANGE', 2],
	['SC-DOC-LIFECYCLE', 2],
	['SC-DOC-TEXT', 2],
	['SC-COL-WORK', 2],
	['SC-SYS-RECOVER', 2],
];
async function open(page: Page, id: string, variant?: string) {
	let url = `/atelier?scenario=${id}`;
	if (variant !== undefined) url += `&variant=${variant}`;
	await page.goto(`${url}&fixture=parcours`);
	await expect(
		page
			.getByRole('navigation', { name: 'Scénarios' })
			.getByRole('button', { name: new RegExp(id) }),
	).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-node-id="comparer"]').first()).toBeVisible();
}
const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
for (const [id, count] of scenarios)
	test(`${id}: every variant starts with a real canvas`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await open(page, id);
		const variants = page.getByRole('navigation', { name: 'Variantes' }).getByRole('button');
		await expect(variants).toHaveCount(count);
		for (let i = 0; i < count; i++) {
			await variants.nth(i).click();
			await expect(variants.nth(i)).toHaveAttribute('aria-pressed', 'true');
			await expect(node(page, 'comparer').first()).toBeVisible();
		}
		expect(errors).toEqual([]);
	});
test('creation adds actual isolated and connected nodes and resets the source', async ({
	page,
}) => {
	await open(page, 'SC-BOX-CREATE');
	await node(page, 'comparer').click();
	await page.getByRole('button', { name: 'Nouvelle boîte', exact: true }).click();
	await page.getByLabel('Contenu', { exact: true }).fill('Faire un essai');
	await page.getByLabel('Relier depuis la sélection').check();
	await page.getByRole('button', { name: 'Créer', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
	await expect(page.getByRole('button', { name: 'Action: Faire un essai' })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await page.getByRole('button', { name: 'Dupliquer la sélection' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	await page.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
});
test('navigation searches and selects a real node and the minimap can return to it', async ({
	page,
}) => {
	await open(page, 'SC-NAV-EXPLORE', 'minimap');
	await page.getByLabel('Rechercher une boîte').fill('hypothèses');
	await page.getByRole('button', { name: 'Vérifier les hypothèses', exact: true }).click();
	await expect(node(page, 'etape-2')).toHaveAttribute('aria-pressed', 'true');
	await expect(node(page, 'etape-2')).toBeInViewport();
	await page.getByRole('button', { name: 'Tout cadrer', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Reset zoom' })).toContainText('%');
});
test('multiple mode, neighbors and rectangle retain their selection after mouseup', async ({
	page,
}) => {
	await open(page, 'SC-SEL-COMPOSE', 'mode');
	await page.getByRole('button', { name: /Sélection multiple inactive/ }).click();
	await node(page, 'collecter').click();
	await node(page, 'explorer').click();
	await expect(page.locator('[data-node-id][aria-pressed="true"]')).toHaveCount(2);
	await page.getByRole('button', { name: 'Étendre aux voisins / au contenu' }).click();
	await expect(node(page, 'comparer')).toHaveAttribute('aria-pressed', 'true');
	await page.getByRole('button', { name: 'Vider', exact: true }).click();
	await node(page, 'comparer').scrollIntoViewIfNeeded();
	const bounds = await node(page, 'comparer').boundingBox();
	expect(bounds).not.toBeNull();
	if (bounds === null) throw new Error('Missing box');
	await page.mouse.move(bounds.x - 10, bounds.y - 10);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width + 10, bounds.y + bounds.height + 10, { steps: 10 });
	await page.mouse.up();
	await expect(node(page, 'comparer')).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Escape');
	await expect(node(page, 'comparer')).toHaveAttribute('aria-pressed', 'false');
});
test('context menu changes actions for a multi-selection and duplicates the source', async ({
	page,
}) => {
	await open(page, 'SC-CTX-ACTIONS', 'menu');
	await node(page, 'collecter').click({ button: 'right' });
	const toolbar = page.getByRole('menu', { name: 'Actions de la sélection' });
	await expect(toolbar).toBeVisible();
	await expect(toolbar.getByRole('menuitem', { name: 'Éditer' })).toBeEnabled();
	await node(page, 'explorer').click({ modifiers: ['ControlOrMeta'] });
	await page.getByRole('button', { name: 'Ouvrir les actions' }).click();
	await expect(toolbar.getByRole('menuitem', { name: 'Éditer' })).toBeDisabled();
	await toolbar.getByRole('menuitem', { name: 'Dupliquer' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
});
test('connections validate cycles, retarget, delete and support the two-click path', async ({
	page,
}) => {
	await open(page, 'SC-REL-CONNECT', 'two-step');
	await page.getByLabel('Source', { exact: true }).selectOption('decider');
	await page.getByLabel('Cible', { exact: true }).selectOption('collecter');
	await page.getByRole('button', { name: 'Valider la relation' }).click();
	await expect(page.locator('.workbench-status')).toHaveClass(/failed/);
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
	await page.getByRole('button', { name: 'Choisir dans le canvas' }).click();
	await node(page, 'collecter').click();
	await node(page, 'explorer').click();
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
	await page.getByLabel('Relation à modifier').selectOption('comparer-decider');
	await page.getByLabel('Source', { exact: true }).selectOption('explorer');
	await page.getByRole('button', { name: 'Valider la relation' }).click();
	await expect(page.locator('[data-relation-id="comparer-decider"]')).toHaveAttribute(
		'aria-label',
		/from explorer to decider/,
	);
	await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
});
test('junction inserts a real XOR and rewires the convergence', async ({ page }) => {
	await open(page, 'SC-REL-JUNCTION', 'explicit');
	await page.getByRole('button', { name: 'Créer la jonction XOR' }).click();
	await expect(page.locator('[data-junction-id]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
});
test('group collapse changes the projection and dissolve preserves its nodes', async ({ page }) => {
	await open(page, 'SC-GRP-ORGANIZE');
	await node(page, 'collecter').click();
	await node(page, 'explorer').click({ modifiers: ['ControlOrMeta'] });
	await page.getByLabel('Nom du groupe').fill('Les pistes');
	await page.getByRole('button', { name: 'Grouper la sélection' }).click();
	await expect(page.locator('[data-group-id]')).toHaveCount(1);
	await page.getByLabel('Nom du groupe').fill('Sources');
	await page.getByRole('button', { name: 'Renommer', exact: true }).click();
	await expect(page.locator('[data-group-id]')).toContainText('Sources');
	await node(page, 'explorer').click();
	await page.getByRole('button', { name: 'Retirer la sélection' }).click();
	await page.getByRole('button', { name: 'Replier / déplier' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(node(page, 'explorer')).toBeVisible();
	await page.getByRole('button', { name: 'Replier / déplier' }).click();
	await page.getByRole('button', { name: 'Ajouter la sélection' }).click();
	await page.getByRole('button', { name: 'Replier / déplier' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(2);
	await page.getByRole('button', { name: 'Replier / déplier' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await page.getByRole('button', { name: 'Dissoudre le groupe' }).click();
	await expect(page.locator('[data-group-id]')).toHaveCount(0);
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
});
test('nature management applies a new nature then reassigns it on deletion', async ({ page }) => {
	await open(page, 'SC-NAT-MANAGE', 'library');
	await node(page, 'comparer').click();
	await page.getByRole('button', { name: 'Nouvelle nature' }).click();
	await page.getByLabel('Libellé').fill('Hypothèse');
	await page.getByRole('button', { name: 'Enregistrer la nature' }).click();
	await page.getByRole('button', { name: 'Appliquer aux boîtes' }).click();
	await expect(node(page, 'comparer')).toContainText('Hypothèse');
	await page.getByRole('button', { name: '● Hypothèse' }).click();
	await page.getByLabel('Réaffecter à').selectOption('goal');
	await page.getByRole('button', { name: 'Supprimer la nature' }).click();
	await expect(node(page, 'comparer')).toContainText('Objectif');
});
test('layout waits for application and changes direction and actual spacing', async ({ page }) => {
	await open(page, 'SC-LAY-ARRANGE', 'apply');
	const before = await node(page, 'comparer').boundingBox();
	await page.getByLabel('Sens de lecture').selectOption('left-to-right');
	expect(await node(page, 'comparer').boundingBox()).toEqual(before);
	await page.getByRole('button', { name: 'Appliquer la disposition' }).click();
	await expect
		.poll(async () => {
			const source = await node(page, 'collecter').boundingBox(),
				target = await node(page, 'comparer').boundingBox();
			return source !== null && target !== null && target.x > source.x + source.width;
		})
		.toBe(true);
	const width = await page.locator('[data-graph-stage]').getAttribute('data-stage-width');
	await page.getByLabel('Espacement').selectOption('1.7');
	await page.getByRole('button', { name: 'Appliquer la disposition' }).click();
	await expect
		.poll(async () =>
			Number(await page.locator('[data-graph-stage]').getAttribute('data-stage-width')),
		)
		.toBeGreaterThan(Number(width));
});
for (const variant of ['live', 'apply'])
	test(`layout ${variant}: undo reconciles controls and spacing does not restore an undone direction`, async ({
		page,
	}) => {
		await open(page, 'SC-LAY-ARRANGE', variant);
		const direction = page.getByLabel('Sens de lecture');
		await direction.selectOption('left-to-right');
		if (variant === 'apply')
			await page.getByRole('button', { name: 'Appliquer la disposition' }).click();
		await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click();
		await expect(direction).toHaveValue('top-to-bottom');
		await page.getByLabel('Espacement').selectOption('1.7');
		if (variant === 'apply')
			await page.getByRole('button', { name: 'Appliquer la disposition' }).click();
		await expect(direction).toHaveValue('top-to-bottom');
		await expect
			.poll(async () => {
				const source = await node(page, 'collecter').boundingBox();
				const target = await node(page, 'comparer').boundingBox();
				return source !== null && target !== null && target.y > source.y + source.height;
			})
			.toBe(true);
	});

test('layout pending settings survive other form changes but are invalidated by undo', async ({
	page,
}) => {
	await open(page, 'SC-LAY-ARRANGE', 'apply');
	const direction = page.getByLabel('Sens de lecture');
	const spacing = page.getByLabel('Espacement');
	await direction.selectOption('left-to-right');
	await spacing.selectOption('1.35');
	await expect(direction).toHaveValue('left-to-right');
	await page.getByRole('button', { name: 'Appliquer la disposition' }).click();
	await direction.selectOption('bottom-to-top');
	await spacing.selectOption('1.7');
	await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click();
	await expect(direction).toHaveValue('top-to-bottom');
	await expect(spacing).toHaveValue('1.35');
});

test('document export and import roundtrip; invalid input keeps the current source', async ({
	page,
}) => {
	await open(page, 'SC-DOC-LIFECYCLE', 'sheet');
	await page.getByLabel('Titre du document').fill('Mon document');
	await page.getByRole('button', { name: 'Renommer le document' }).click();
	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Exporter le document' }).click();
	const download = await downloadPromise;
	const path = await download.path();
	const text = await readFile(path, 'utf8');
	expect(text).toContain('Mon document');
	await page.getByRole('button', { name: 'Nouveau document', exact: true }).click();
	await page.getByRole('button', { name: 'Créer le document vide' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(0);
	await page.getByLabel('Texte à importer').fill(text);
	await page.getByRole('button', { name: 'Importer le texte' }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await page.getByLabel('Texte à importer').fill('bad = [');
	await page.getByRole('button', { name: 'Importer le texte' }).click();
	await expect(page.locator('.workbench-status')).toContainText('Import refusé');
	await expect(page.getByLabel('Titre du document')).toHaveValue('Mon document');
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
});
test('text projection validates edits and preserves the graph on invalid draft', async ({
	page,
}) => {
	await open(page, 'SC-DOC-TEXT', 'dedicated');
	const input = page.getByLabel('Source du document');
	const original = await input.inputValue();
	await input.fill(original.replace('Comparer les options', 'Comparer ensemble'));
	await page.getByRole('button', { name: 'Appliquer le texte' }).click();
	await expect(node(page, 'comparer')).toContainText('Comparer ensemble');
	await input.fill('bad');
	await page.getByRole('button', { name: 'Appliquer le texte' }).click();
	await expect(page.locator('.workbench-status')).toContainText('Texte non appliqué');
	await expect(node(page, 'comparer')).toContainText('Comparer ensemble');
	await page.getByRole('button', { name: 'Abandonner le brouillon et relire' }).click();
	await expect(input).toHaveValue(/Comparer ensemble/);
});
for (const variant of ['undo-first', 'confirm-impact'])
	test(`recovery ${variant} restores nodes and incident edges`, async ({ page }) => {
		await open(page, 'SC-SYS-RECOVER', variant);
		await node(page, 'comparer').click();
		await page.getByRole('button', { name: 'Supprimer la sélection' }).click();
		if (variant === 'confirm-impact') {
			await expect(page.getByRole('dialog')).toContainText('3 relation(s)');
			await page.getByRole('button', { name: 'Conserver', exact: true }).click();
			await expect(node(page, 'comparer')).toBeVisible();
			await page.getByRole('button', { name: 'Supprimer la sélection' }).click();
			await page.getByRole('button', { name: 'Confirmer la suppression' }).click();
		}
		await expect(node(page, 'comparer')).toHaveCount(0);
		await expect(page.locator('[data-relation-id]')).toHaveCount(0);
		await page.getByRole('button', { name: 'Annuler la modification' }).click();
		await expect(node(page, 'comparer')).toBeVisible();
		await expect(page.locator('[data-relation-id]')).toHaveCount(3);
		await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
		await expect(node(page, 'comparer')).toHaveCount(0);
	});
test('feedback survives scenario changes, reset and reload, and downloads all sheets', async ({
	page,
}) => {
	await open(page, 'SC-BOX-CREATE');
	await page.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await page.getByLabel('Ce qui aide / ce qui gêne').fill('Le raccourci aide.');
	await page.getByLabel('Préférence', { exact: true }).selectOption('keyboard');
	await page.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.getByLabel('Ce qui aide / ce qui gêne')).toHaveValue('Le raccourci aide.');
	await page.reload();
	await page.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await expect(page.getByLabel('Ce qui aide / ce qui gêne')).toHaveValue('Le raccourci aide.');
	const waiting = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Télécharger toutes les fiches (.md)' }).click();
	const download = await waiting;
	const path = await download.path();
	const text = await readFile(path, 'utf8');
	expect(text).toContain('Le raccourci aide.');
	expect(text.match(/^## SC-/gm)).toHaveLength(15);
});
test('two network sessions converge after offline editing and reconnect', async ({ page }) => {
	await open(page, 'SC-COL-WORK', 'activity');
	const alice = page.getByRole('region', { name: 'Session Alice' });
	const bob = page.getByRole('region', { name: 'Session Bob' });
	await expect(alice.locator('header').getByRole('status')).toHaveText('Connecté');
	await expect(bob.locator('header').getByRole('status')).toHaveText('Connecté');
	await bob.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await bob.locator('[data-node-id="comparer"]').dblclick();
	await bob.getByRole('textbox').fill('Une modification hors ligne');
	await bob.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(bob.getByRole('button', { name: 'Enregistrement…' })).toBeVisible();
	await alice.locator('[data-node-id="collecter"]').dblclick();
	await alice.getByRole('textbox').fill('Une observation distante');
	await alice.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(alice.getByRole('textbox')).toHaveCount(0);
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await expect(bob.locator('header').getByRole('status')).toHaveText('Connecté');
	await expect(alice.locator('[data-node-id="comparer"]')).toContainText(
		'Une modification hors ligne',
	);
	await expect(bob.locator('[data-node-id="collecter"]')).toContainText('Une observation distante');
});

test('connection handles draw and commit, and Escape abandons an active drag', async ({ page }) => {
	await open(page, 'SC-REL-CONNECT', 'handles');
	const handle = page.getByRole('button', { name: 'Connecter depuis collecter' });
	const start = await handle.boundingBox(),
		end = await node(page, 'explorer').boundingBox();
	if (start === null || end === null) throw new Error('Missing endpoints');
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
	await expect(page.locator('.connection-preview')).toBeVisible();
	await page.mouse.up();
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
	await expect(page.locator('.connection-preview')).toHaveCount(0);
	const next = await handle.boundingBox();
	if (next === null) throw new Error('Missing handle');
	await page.mouse.move(next.x + 5, next.y + 5);
	await page.mouse.down();
	await page.mouse.move(next.x + 40, next.y + 40);
	await page.keyboard.press('Escape');
	await page.mouse.up();
	await expect(page.locator('.connection-preview')).toHaveCount(0);
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
});
test('creation stays usable on a narrow screen and N focuses its form', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 780 });
	await open(page, 'SC-BOX-CREATE', 'keyboard');
	await node(page, 'comparer').press('n');
	const input = page.getByLabel('Contenu', { exact: true });
	await expect(input).toBeFocused();
	await input.fill('Un essai étroit');
	await page.getByRole('button', { name: 'Créer', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
		.toBe(true);
});
test('two editors for the same node have distinct fields and converge on accepted content', async ({
	page,
}) => {
	await open(page, 'SC-COL-WORK');
	const alice = page.getByRole('region', { name: 'Session Alice' }),
		bob = page.getByRole('region', { name: 'Session Bob' });
	await expect(alice.locator('header').getByRole('status')).toHaveText('Connecté');
	await expect(bob.locator('header').getByRole('status')).toHaveText('Connecté');
	await alice.locator('[data-node-id="comparer"]').dblclick();
	await bob.locator('[data-node-id="comparer"]').dblclick();
	const a = alice.getByLabel('Contenu Markdown'),
		b = bob.getByLabel('Contenu Markdown');
	expect(await a.getAttribute('id')).not.toBe(await b.getAttribute('id'));
	await b.fill('Le brouillon de Bob');
	await a.press('Escape');
	await expect(a).toHaveCount(0);
	await expect(b).toHaveValue('Le brouillon de Bob');
	await alice.locator('[data-node-id="comparer"]').dblclick();
	await a.fill('Le brouillon d’Alice');
	await alice.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await bob.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect
		.poll(async () => {
			const left = await alice.locator('[data-node-id="comparer"]').textContent(),
				right = await bob.locator('[data-node-id="comparer"]').textContent();
			return left === right;
		})
		.toBe(true);
});

test('composed creation and multi-duplication each undo and redo in one step', async ({ page }) => {
	await open(page, 'SC-BOX-CREATE');
	await node(page, 'comparer').click();
	await page.getByRole('button', { name: 'Nouvelle boîte', exact: true }).click();
	await page.getByLabel('Contenu', { exact: true }).fill('Une suite reliée');
	await page.getByLabel('Relier depuis la sélection').check();
	await page.getByRole('button', { name: 'Créer', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	await page.getByRole('button', { name: 'Annuler la modification', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
	await expect(
		page.getByRole('button', { name: 'Annuler la modification', exact: true }),
	).toBeDisabled();
	await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	await expect(page.locator('[data-relation-id]')).toHaveCount(4);
	await open(page, 'SC-CTX-ACTIONS', 'fixed');
	await node(page, 'collecter').click();
	await node(page, 'explorer').click({ modifiers: ['ControlOrMeta'] });
	await page.getByRole('button', { name: 'Dupliquer', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	await node(page, 'comparer').press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await node(page, 'comparer').press('ControlOrMeta+Shift+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
});

test('menu keyboard navigation returns focus, exits with Tab, and the trigger toggles', async ({
	page,
}) => {
	await open(page, 'SC-CTX-ACTIONS', 'menu');
	await node(page, 'comparer').click();
	const trigger = page.getByRole('button', { name: 'Ouvrir les actions' });
	const menu = page.getByRole('menu', { name: 'Actions de la sélection' });
	await trigger.press('Enter');
	await expect(menu.getByRole('menuitem', { name: 'Éditer' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(menu.getByRole('menuitem', { name: 'Dupliquer' })).toBeFocused();
	await page.keyboard.press('Home');
	await expect(menu.getByRole('menuitem', { name: 'Éditer' })).toBeFocused();
	await page.keyboard.press('End');
	await expect(menu.getByRole('menuitem', { name: 'Dupliquer' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(trigger).toBeFocused();
	await expect(node(page, 'comparer')).toHaveAttribute('aria-pressed', 'true');
	await trigger.click();
	await page.keyboard.press('Tab');
	await expect(menu).toHaveCount(0);
	await expect(page.locator('body')).not.toBeFocused();
	await trigger.click();
	await expect(menu).toBeVisible();
	await trigger.click();
	await expect(menu).toHaveCount(0);
});

test('scenario and variant URLs survive reload and browser back/forward', async ({ page }) => {
	await open(page, 'SC-BOX-CREATE', 'palette');
	await page
		.getByRole('navigation', { name: 'Variantes' })
		.getByRole('button', { name: /Commande N/ })
		.click();
	await expect(page).toHaveURL(/scenario=SC-BOX-CREATE&variant=keyboard/);
	await page
		.getByRole('navigation', { name: 'Scénarios' })
		.getByRole('button', { name: /SC-LAY-ARRANGE/ })
		.click();
	await expect(page).toHaveURL(/scenario=SC-LAY-ARRANGE&variant=live/);
	await page.goBack();
	await expect(
		page.getByRole('navigation', { name: 'Variantes' }).getByRole('button', { name: /Commande N/ }),
	).toHaveAttribute('aria-pressed', 'true');
	await page.reload();
	await expect(page).toHaveURL(/variant=keyboard/);
	await expect(page.getByRole('button', { name: 'Recommencer' })).toBeEnabled();
	await page.goForward();
	await expect(page.getByLabel('Sens de lecture')).toBeVisible();
});

test('ordering first actually moves a box before its peer in the canvas', async ({ page }) => {
	await open(page, 'SC-LAY-ARRANGE');
	await page.getByLabel('Boîte à placer en premier').selectOption('explorer');
	await page.getByRole('button', { name: 'Placer en premier dans son rang' }).click();
	await expect
		.poll(async () => {
			const first = await node(page, 'explorer').boundingBox(),
				second = await node(page, 'collecter').boundingBox();
			return first !== null && second !== null && first.x < second.x;
		})
		.toBe(true);
});

test('text follows clean graph edits and protects a draft when the graph changes', async ({
	page,
}) => {
	await open(page, 'SC-DOC-TEXT', 'split');
	const source = page.getByLabel('Source du document');
	await node(page, 'comparer').dblclick();
	await page.getByLabel('Node Markdown').fill('Une modification du graphe');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(source).toHaveValue(/Une modification du graphe/);
	await source.fill((await source.inputValue()).replace('Préparer une décision', 'Mon brouillon'));
	const draft = await source.inputValue();
	await node(page, 'comparer').dblclick();
	await page.getByLabel('Node Markdown').fill('Nouvelle version du graphe');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(source).toHaveValue(draft);
	await expect(page.getByRole('button', { name: 'Appliquer le texte' })).toBeDisabled();
	await expect(page.getByText('Graphe modifié · brouillon conservé')).toBeVisible();
	await page.getByRole('button', { name: 'Abandonner le brouillon et relire' }).click();
	await expect(source).toHaveValue(/Nouvelle version du graphe/);
});

test('feedback saves each keystroke and keeps other tabs’ scenario notes', async ({
	page,
	context,
}) => {
	await open(page, 'SC-BOX-CREATE');
	const second = await context.newPage();
	await open(second, 'SC-LAY-ARRANGE');
	for (const tab of [page, second])
		await tab.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	const notes = page.getByLabel('Ce qui aide / ce qui gêne');
	await notes.pressSequentially('abc');
	await expect(notes).toHaveValue('abc');
	await second.getByLabel('Ce qui aide / ce qui gêne').fill('Une autre fiche');
	await notes.pressSequentially('d');
	await second.reload();
	await second.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await expect(second.getByLabel('Ce qui aide / ce qui gêne')).toHaveValue('Une autre fiche');
	await page.reload();
	await page.getByText('Terminer ce parcours · mes remarques', { exact: true }).click();
	await expect(notes).toHaveValue('abcd');
	await second.close();
});

test('closing an offline submission keeps it pending and blocks a second ambiguous save', async ({
	page,
}) => {
	await open(page, 'SC-COL-WORK');
	const alice = page.getByRole('region', { name: 'Session Alice' }),
		bob = page.getByRole('region', { name: 'Session Bob' });
	await expect(bob.locator('header').getByRole('status')).toHaveText('Connecté');
	await bob.getByRole('button', { name: 'Mettre hors ligne' }).click();
	await bob.locator('[data-node-id="comparer"]').dblclick();
	await bob.getByLabel('Contenu Markdown').fill('Envoi à conserver');
	await bob.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(
		bob.getByText('Modification en attente de validation. Fermer ne retire pas cet envoi.'),
	).toBeVisible();
	await bob.getByRole('button', { name: 'Fermer', exact: true }).click();
	await bob.locator('[data-node-id="collecter"]').dblclick();
	await bob.getByLabel('Contenu Markdown').fill('Deuxième brouillon');
	await bob.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(bob.getByRole('alert')).toContainText(
		'Une modification attend encore sa validation',
	);
	await bob.getByRole('button', { name: 'Reconnecter' }).click();
	await expect(alice.locator('[data-node-id="comparer"]')).toContainText('Envoi à conserver');
	await expect(bob.getByLabel('Contenu Markdown')).toHaveValue('Deuxième brouillon');
	await bob.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect(alice.locator('[data-node-id="collecter"]')).toContainText('Deuxième brouillon');
});
