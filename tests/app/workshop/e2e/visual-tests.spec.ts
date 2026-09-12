import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

test('uses English direction labels and reruns with a compatible bias kept between screens', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	const direction = page.getByRole('combobox', { name: 'Direction', exact: true });
	const bias = page.getByRole('combobox', { name: 'Bias', exact: true });
	await expect(direction.locator('option')).toHaveText([
		'Top to bottom',
		'Bottom to top',
		'Left to right',
		'Right to left',
	]);
	await expect(bias.locator('option')).toHaveText(['Top', 'Bottom']);
	await expect(bias).toHaveValue('top');
	await expect(page.getByRole('status')).toContainText('Réussi');
	await bias.selectOption('bottom');
	await expect(page.getByRole('status')).toContainText('Réussi');
	await direction.selectOption('bottom-to-top');
	await expect(bias).toHaveValue('bottom');
	await page.getByRole('button', { name: 'B → A · A racine', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(direction).toHaveValue('bottom-to-top');
	await expect(bias).toHaveValue('bottom');
	await direction.selectOption('left-to-right');
	await expect(bias.locator('option')).toHaveText(['Left', 'Right']);
	await expect(bias).toHaveValue('left');
	await bias.selectOption('right');
	await direction.selectOption('right-to-left');
	await expect(bias).toHaveValue('right');
	await direction.selectOption('top-to-bottom');
	await expect(bias.locator('option')).toHaveText(['Top', 'Bottom']);
	await expect(bias).toHaveValue('top');
	await expect(page.getByRole('status')).toContainText('Réussi');
});

test('persists visual settings between scenarios and page reloads', async ({ page }) => {
	await page.goto('/atelier/tests-visuels');
	const direction = page.getByRole('combobox', { name: 'Direction', exact: true });
	const bias = page.getByRole('combobox', { name: 'Bias', exact: true });
	const guides = page.getByRole('checkbox', { name: 'Afficher les centres et coordonnées' });

	await direction.selectOption('left-to-right');
	await bias.selectOption('right');
	await guides.uncheck();
	await page.getByRole('button', { name: 'Un nœud', exact: true }).click();

	await expect(direction).toHaveValue('left-to-right');
	await expect(bias).toHaveValue('right');
	await expect(guides).not.toBeChecked();
	await expect(page.locator('[data-center-guide]')).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(direction).toHaveValue('left-to-right');
	await expect(bias).toHaveValue('right');
	await expect(guides).not.toBeChecked();
	await expect(page.locator('[data-center-guide]')).toHaveCount(0);
});

test('opens the glossary entry referenced by the scenario', async ({ page }) => {
	await page.goto('/atelier/tests-visuels');
	await page.getByRole('link', { name: 'VL-505 · Alignés' }).click();
	await expect(page).toHaveURL(/\/atelier\/lexique#VL-505$/);
	await expect(page.locator('.entry-heading a')).toHaveText('VL-505');
	await expect(page.getByLabel('Terme français')).not.toBeEmpty();
});

test('follows the browser color scheme without resetting the scenario', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/atelier/tests-visuels');
	await expect(page.getByRole('status')).toContainText('Réussi');
	const code = page.locator('pre code.hljs');
	const light = await code.evaluate((element) => {
		const style = getComputedStyle(element);
		return { color: style.color, background: style.backgroundColor };
	});
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(code).not.toHaveCSS('background-color', light.background);
	await expect(code).not.toHaveCSS('color', light.color);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(code).toHaveCSS('background-color', light.background);
	await expect(code).toHaveCSS('color', light.color);
	await expect(page.getByRole('status')).toContainText('Réussi');
});

test('opens the preview on screen load and preserves the result when reopened', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	await expect(page.getByRole('heading', { name: 'Deux largeurs, un même axe.' })).toBeVisible();
	await expect(page.locator('pre')).toContainText('AssertBox(a).isAlignedWith(b');
	const source = readFileSync(
		new URL('../../../scenarios/visual/nodes/centered-chain.scenario.ts', import.meta.url),
		'utf8',
	);
	expect(await page.locator('pre code').textContent()).toBe(source);
	const baseColor = await page
		.locator('pre code.hljs')
		.evaluate((code) => getComputedStyle(code).color);
	await expect(page.locator('pre .hljs-keyword').first()).not.toHaveCSS('color', baseColor);
	await expect(page.locator('pre .hljs-string').first()).not.toHaveCSS('color', baseColor);
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(page.getByRole('img', { name: 'Géométrie du scénario' })).toBeVisible();
	const panel = page.locator('details.visual-control');
	await expect(panel).toHaveAttribute('open', '');
	await expect(panel.getByRole('combobox', { name: 'Direction', exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Réexécuter le scénario' })).toBeVisible();
	await expect(page.locator('[data-center-guide]')).toHaveCount(2);
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(page.locator('[data-box-id]')).toHaveCount(2);
	await page.getByRole('checkbox').uncheck();
	await expect(page.locator('[data-center-guide]')).toHaveCount(0);
	// Reopening only reveals the current checked result.
	await page.getByText('02 / Contrôle visuel', { exact: true }).click();
	await expect(page.getByRole('img')).toHaveCount(0);
	await expect(page.getByRole('status')).toContainText('Réussi');
	await page.getByText('02 / Contrôle visuel', { exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(page.getByRole('img')).toBeVisible();
	await page.getByRole('button', { name: 'Réexécuter le scénario' }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await page.getByText('02 / Contrôle visuel', { exact: true }).click();
	await expect(page.getByRole('img')).toHaveCount(0);
});

for (const scenario of [
	{ tab: 'Un nœud', heading: 'Un nœud, au centre.', ranks: ['1'] },
	{ tab: 'Deux nœuds sans lien', heading: 'Deux nœuds, un même rang.', ranks: ['1', '1'] },
	{ tab: 'B → A · A racine', heading: 'A puis B, dans le bon sens.', ranks: ['1', '2'] },
	{ tab: 'Deux successeurs', heading: 'Deux successeurs.', ranks: ['1', '2', '2'] },
	{ tab: 'Trois successeurs', heading: 'Trois successeurs.', ranks: ['1', '2', '2', '2'] },
	{
		tab: 'Trois successeurs et un nœud isolé',
		heading: 'Trois successeurs et un nœud isolé.',
		ranks: ['1', '2', '2', '2', '1'],
	},
	{
		tab: 'Une branche et une chaîne indépendantes',
		heading: 'Une branche et une chaîne indépendantes.',
		ranks: ['1', '2', '2', '2', '1', '2'],
	},
	{
		tab: 'Un enfant et deux parents',
		heading: 'Un enfant et deux parents.',
		ranks: ['1', '1', '2'],
	},
	{
		tab: 'Un enfant et trois parents',
		heading: 'Un enfant et trois parents.',
		ranks: ['1', '1', '1', '2'],
	},
	{ tab: 'Un losange', heading: 'Un losange.', ranks: ['1', '2', '2', '3'] },
	{
		tab: 'Un croisement évitable par permutation',
		heading: 'Un croisement évitable par permutation.',
		ranks: ['1', '1', '2', '2'],
	},
]) {
	test(`automatically reruns ${scenario.tab} in four directions`, async ({ page }) => {
		await page.goto('/atelier/tests-visuels');
		await page.getByRole('button', { name: scenario.tab, exact: true }).click();
		await expect(page.getByRole('heading', { name: scenario.heading })).toBeVisible();
		await expect(page.getByRole('status')).toContainText('Réussi');
		for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
			await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
			await expect(page.getByRole('status')).toContainText('Réussi');
			await expect(page.getByRole('img', { name: 'Géométrie du scénario' })).toBeVisible();
			await expect(page.locator('[data-box-id]')).toHaveCount(scenario.ranks.length);
			expect(
				await page
					.locator('[data-box-id]')
					.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-rank'))),
			).toEqual(scenario.ranks);
		}
		await page.getByRole('button', { name: 'Tailles différentes', exact: true }).click();
		await expect(page.getByRole('status')).toContainText('Réussi');
		await expect(page.getByRole('combobox', { name: 'Direction', exact: true })).toHaveValue(
			'right-to-left',
		);
	});
}

test('keeps direction across screens and automatically updates the drawn geometry', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	await page.getByRole('button', { name: 'B → A · A racine', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	const direction = page.getByRole('combobox', { name: 'Direction', exact: true });
	const a = page.locator('[data-box-id="a"] rect');
	const b = page.locator('[data-box-id="b"] rect');
	await expect(a).toHaveAttribute('y', '40');
	await expect(b).toHaveAttribute('y', '172');
	await direction.selectOption('bottom-to-top');
	await expect(a).toHaveAttribute('y', '172');
	await expect(b).toHaveAttribute('y', '40');
	await direction.selectOption('left-to-right');
	await expect(a).toHaveAttribute('x', '40');
	await expect(b).toHaveAttribute('x', '212');
	await direction.selectOption('right-to-left');
	await expect(a).toHaveAttribute('x', '212');
	await expect(b).toHaveAttribute('x', '40');
	await page.getByRole('button', { name: 'Deux nœuds sans lien', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(direction).toHaveValue('right-to-left');
	await direction.selectOption('left-to-right');
	await page.getByRole('button', { name: 'B → A · A racine', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Réussi');
	await expect(direction).toHaveValue('left-to-right');
	await expect(a).toHaveAttribute('x', '40');
	await expect(b).toHaveAttribute('x', '212');
});

test('browses groups and searches scenarios by their stable identifier', async ({ page }) => {
	await page.goto('/atelier/tests-visuels');
	const navigation = page.getByRole('navigation', { name: 'Scénarios d’assertions visuelles' });
	await expect(navigation.locator('details')).toHaveCount(5);
	await navigation.getByText('Rangs et progression', { exact: false }).click();
	await expect(
		navigation.getByRole('button', { name: 'B → A · A racine', exact: true }),
	).toBeHidden();
	await navigation.getByText('Rangs et progression', { exact: false }).click();
	await navigation.getByRole('button', { name: 'B → A · A racine', exact: true }).click();
	await expect(page.locator('.scenario-identity')).toContainText('directed-chain');
	await expect(page.locator('.scenario-identity')).toContainText('Rangs et progression');
	await expect(page.getByRole('status')).toContainText('Réussi');
	const search = page.getByRole('searchbox', { name: 'Rechercher un scénario' });
	await search.fill('single-node');
	await expect(navigation.getByRole('button')).toHaveCount(1);
	await navigation.getByRole('button', { name: 'Un nœud', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Un nœud, au centre.' })).toBeVisible();
	await expect(page.locator('.scenario-identity')).toContainText('single-node');
	await expect(page.locator('.scenario-identity')).toContainText('Centrage et alignement');
	await search.fill('unknown-test');
	await expect(navigation).toContainText('Aucun scénario trouvé.');
	await search.clear();
	await expect(navigation.getByRole('button')).toHaveCount(23);
});

test('aligns the toolbar and keeps settings visible after either setting changes', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1017, height: 700 });
	await page.goto('/atelier/tests-visuels');
	await expect(page.getByRole('img', { name: 'Géométrie du scénario' })).toBeVisible();
	const controls = await page
		.locator('.execution-bar')
		.locator('select, button')
		.evaluateAll((elements) =>
			elements.map((element) => {
				const rect = element.getBoundingClientRect();
				return { top: rect.top, bottom: rect.bottom, height: rect.height };
			}),
		);
	expect(controls).toHaveLength(3);
	for (const control of controls) expect(control).toEqual(controls[0]);
	for (const setting of [
		{ name: 'Direction', value: 'bottom-to-top' },
		{ name: 'Bias', value: 'bottom' },
	]) {
		const select = page.getByRole('combobox', { name: setting.name, exact: true });
		await select.evaluate((element) => {
			element.scrollIntoView({ block: 'end' });
		});
		await select.selectOption(setting.value);
		await expect(page.getByRole('status')).toContainText('Réussi');
		await expect(select).toBeInViewport();
	}
});

test('draws distinct shared-successor routes with a bridge in every layout configuration', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	await page
		.getByRole('button', { name: 'Deux parents et deux successeurs communs', exact: true })
		.click();
	await expect(
		page.getByRole('heading', { name: 'Deux parents et deux successeurs communs.' }),
	).toBeVisible();
	for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
		await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
		const bias = page.getByRole('combobox', { name: 'Bias', exact: true });
		const values = await bias
			.locator('option')
			.evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));
		for (const value of values) {
			await bias.selectOption(value);
			await expect(page.getByRole('status')).toContainText('Réussi');
			await expect(page.locator('[data-box-id]')).toHaveCount(4);
			await expect(page.locator('path[data-rendered-relation-id]')).toHaveCount(4);
			await expect
				.poll(() =>
					page
						.locator('path[data-rendered-relation-id]')
						.evaluateAll(
							(paths) =>
								paths.filter((path) => (path.getAttribute('d') ?? '').includes(' A ')).length,
						),
				)
				.toBeGreaterThan(0);
		}
	}
});

test('keeps the descendant centering failure visible with its four-node drawing', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	await page
		.getByRole('button', { name: 'Deux successeurs et un descendant', exact: true })
		.click();
	await expect(
		page.getByRole('heading', { name: 'Deux successeurs et un descendant.' }),
	).toBeVisible();
	await expect(page.getByRole('status')).toContainText(
		'Box "envelope(d)" is not aligned with box "b"',
	);
	await expect(page.getByRole('status')).toContainText('difference=68');
	await expect(page.locator('[data-box-id]')).toHaveCount(4);
	await expect(page.locator('[data-box-id="d"]')).toHaveAttribute('data-rank', '3');
	await page
		.getByRole('combobox', { name: 'Direction', exact: true })
		.selectOption('left-to-right');
	await expect(page.getByRole('status')).toContainText('difference=48');
	await expect(page.locator('path[data-rendered-relation-id]')).toHaveCount(3);
});

test('renders the application arrow SVG from child B to root A in all four directions', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels');
	await page.getByRole('button', { name: 'B → A · A racine', exact: true }).click();
	for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
		await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
		await expect(page.getByRole('status')).toContainText('Réussi');
		const path = page.locator('path[data-rendered-relation-id]');
		await expect(path).toHaveAttribute('data-edge-from', 'b');
		await expect(path).toHaveAttribute('data-edge-to', 'a');
		await expect(path).toHaveAttribute('stroke-linejoin', 'round');
		await expect(path).toHaveAttribute('vector-effect', 'non-scaling-stroke');
		const marker = page.locator('.layout-preview marker');
		await expect(marker).toHaveAttribute('markerUnits', 'userSpaceOnUse');
		await expect(marker.locator('path')).toHaveAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
		await expect(path).toHaveAttribute('marker-end', `url(#${await marker.getAttribute('id')})`);
		const tip = await path.evaluate((element) => {
			if (!(element instanceof SVGPathElement)) throw new Error('Expected an SVG path');
			const point = element.getPointAtLength(element.getTotalLength());
			return { x: point.x, y: point.y };
		});
		const root = await page.locator('[data-box-id="a"] rect').evaluate((element) => {
			if (!(element instanceof SVGRectElement)) throw new Error('Expected the root rectangle');
			const { x, y, width, height } = element.getBBox();
			return { x, y, width, height };
		});
		if (direction === 'top-to-bottom') expect(tip.y).toBe(root.y + root.height);
		if (direction === 'bottom-to-top') expect(tip.y).toBe(root.y);
		if (direction === 'left-to-right') expect(tip.x).toBe(root.x + root.width);
		if (direction === 'right-to-left') expect(tip.x).toBe(root.x);
	}
});

test('navigates scenarios through shareable URLs and browser history', async ({ page }) => {
	await page.goto('/atelier/tests-visuels');
	await expect(page).toHaveURL(/\/atelier\/tests-visuels\/centered-chain$/);
	await page.getByRole('button', { name: 'Un nœud', exact: true }).click();
	await expect(page).toHaveURL(/\/atelier\/tests-visuels\/single-node$/);
	await expect(page.getByRole('heading', { name: 'Un nœud, au centre.' })).toBeVisible();
	await page.getByRole('button', { name: 'Un nœud', exact: true }).click();
	await page.goBack();
	await expect(page).toHaveURL(/\/atelier\/tests-visuels\/centered-chain$/);
	await expect(page.getByRole('heading', { name: 'Deux largeurs, un même axe.' })).toBeVisible();
	await page.goForward();
	await expect(page).toHaveURL(/\/atelier\/tests-visuels\/single-node$/);
	await expect(page.getByRole('heading', { name: 'Un nœud, au centre.' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Un nœud, au centre.' })).toBeVisible();
	await page.goto('/atelier/tests-visuels/default-quays');
	await expect(page.locator('.scenario-identity')).toContainText('default-quays');
	await expect(page.locator('.scenario-tree button[aria-pressed="true"]')).toHaveAttribute(
		'aria-pressed',
		'true',
	);
});

test('keeps the checked result when toggling geometry guides', async ({ page }) => {
	await page.goto('/atelier/tests-visuels/centered-chain');
	await expect(page.getByRole('status')).toContainText('Réussi');
	const status = page.getByRole('status');
	const verdict = await status.textContent();
	const box = page.locator('[data-box-id="b"] rect');
	const x = await box.getAttribute('x');
	const y = await box.getAttribute('y');
	const guides = page.getByRole('checkbox', { name: 'Afficher les centres et coordonnées' });
	await guides.uncheck();
	await expect(page.locator('[data-center-guide]')).toHaveCount(0);
	await expect(status).toHaveText(verdict ?? '');
	await guides.check();
	await expect(page.locator('[data-center-guide]').first()).toBeVisible();
	await expect(box).toHaveAttribute('x', x ?? '');
	await expect(box).toHaveAttribute('y', y ?? '');

	const panel = page.locator('details.visual-control');
	await panel.locator('summary').click();
	await expect(page.locator('.layout-preview')).toHaveCount(0);
	await panel.locator('summary').click();
	await expect(status).toHaveText(verdict ?? '');
	await expect(box).toHaveAttribute('x', x ?? '');
	await expect(box).toHaveAttribute('y', y ?? '');
	await page.getByRole('button', { name: 'Réexécuter le scénario' }).click();
	await expect(status).toContainText('Réussi');
});
