import { globSync } from 'node:fs';
import { basename } from 'node:path';

import { expect, test } from '@playwright/test';

const scenarios = globSync('tests/scenarios/visual/junctions/*.scenario.ts')
	.map((path) => basename(path, '.scenario.ts'))
	.sort();

// Every displayed variant must satisfy the same executable contract as the unit runner.
for (const id of scenarios) {
	test(`presents the executable junction specification ${id}`, async ({ page }) => {
		await page.goto(`/atelier/tests-visuels/${id}`);
		await expect(page.locator('.scenario-identity')).toContainText(id);
		const verdict = page.getByRole('status');
		await expect(verdict).toContainText('Réussi');
		await expect(page.getByRole('img', { name: 'Géométrie du scénario' }).first()).toBeVisible();
		await expect(verdict).not.toContainText(/TypeError|undefined|NaN|introuvable|Missing/);
		await expect(page.locator('details.visual-control')).toHaveAttribute('open', '');
		await expect(page.locator('.test-code')).toContainText('AssertLayout');
		const variants = page.getByRole('combobox', { name: 'Variante', exact: true });
		if (await variants.count()) {
			const ids = await variants
				.locator('option')
				.evaluateAll((options) => options.map((option) => option.getAttribute('value') ?? ''));
			for (const variant of ids) {
				await variants.selectOption(variant);
				await expect(page.locator('.visual-test')).toHaveAttribute('data-scenario-id', variant);
				await expect(verdict).toContainText('Réussi');
				await expect(
					page.getByRole('img', { name: 'Géométrie du scénario' }).first(),
				).toBeVisible();
				await expect(page.locator('.variant-description')).not.toBeEmpty();
			}
		}
	});
}

test('reruns a junction chain in all directions with its visual control open', async ({ page }) => {
	await page.goto('/atelier/tests-visuels/junction-chain');
	for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
		await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
		await expect(page.getByRole('status')).toContainText('Réussi');
		await expect(page.locator('[data-box-id]')).toHaveCount(4);
		await expect(page.locator('[data-box-id="a"]')).toHaveAttribute('data-rank', '1');
		await expect(page.locator('[data-box-id="b"]')).toHaveAttribute('data-rank', '2');
	}
});

test('uses the main canvas junction symbol in the workshop and keeps diagnostic highlighting', async ({
	page,
}) => {
	await page.goto('/');
	const mainSymbol = page.locator('[data-junction-symbol]').first();
	await expect(mainSymbol).toBeVisible();
	await expect(mainSymbol).toHaveAttribute('height', '20');
	await expect(mainSymbol.locator('text')).toHaveAttribute('font-size', '6.5');
	const outline = mainSymbol.locator('rect');
	const appearance = await outline.evaluate((element) => ({
		fill: element.getAttribute('fill'),
		stroke: element.getAttribute('stroke'),
	}));
	await page.route(
		/\/tests\/scenarios\/visual\/junctions\/junction-base-rail\.scenario\.ts(?:\?|$)/,
		async (route) => {
			const response = await route.fetch();
			let body = await response.text();
			if (!new URL(route.request().url()).searchParams.has('raw'))
				body +=
					"\nscenario.assert = (layout) => { AssertLayout(layout).junction('j').isAlignedWith('a', { by: 'row' }); };\n";
			await route.fulfill({ response, body });
		},
	);
	await page.goto('/atelier/tests-visuels/junction-base-rail');
	const junction = page.locator('[data-box-id="j"]');
	const symbol = junction.locator('[data-junction-symbol="xor"]');
	await expect(symbol).toBeVisible();
	await expect(symbol.locator('text')).toHaveText('XOR');
	await expect(page.getByRole('status')).toContainText('Échec du scénario');
	await expect(symbol.locator('rect')).toHaveCSS('stroke', 'rgb(180, 35, 24)');
	await expect(symbol.locator('rect')).toHaveAttribute('fill', appearance.fill ?? '');
	await expect(symbol.locator('rect')).toHaveAttribute('stroke', appearance.stroke ?? '');
	await expect(symbol.locator('rect')).toHaveAttribute('rx', '10');
	await expect(junction.locator(':scope > rect')).toHaveCount(0);
	await expect(junction.locator(':scope > text')).toHaveCount(0);
	await expect(page.locator('[data-box-id="a"] > rect')).toHaveCount(1);
	await page.getByRole('checkbox', { name: 'Afficher les centres et coordonnées' }).check();
	await expect(junction.locator('[data-center-guide="j"]')).toBeVisible();
});

test('keeps junctions compact at their real bounds and exposes their occupied rails and ports', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels/junction-crossing-ports');
	await page.getByRole('checkbox', { name: 'Afficher les rails et les ports' }).check();
	for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
		await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
		await expect(page.getByRole('status')).toContainText('Réussi');
		for (const id of ['j1', 'j2']) {
			const symbol = page.locator(`[data-box-id="${id}"] [data-junction-symbol]`);
			await expect(symbol).toHaveAttribute('width', '28');
			await expect(symbol).toHaveAttribute('height', '20');
			await expect(symbol.locator('rect')).toHaveAttribute('rx', '10');
			await expect(symbol.locator('text')).toHaveAttribute('font-size', '6.5');
			const padding = await symbol.locator('text').evaluate((text) => {
				if (!(text instanceof SVGGraphicsElement)) throw new Error('Expected SVG text.');
				const box = text.getBBox();
				return {
					x: box.x,
					y: box.y,
					right: 28 - box.x - box.width,
					bottom: 20 - box.y - box.height,
				};
			});
			for (const gap of Object.values(padding)) expect(gap).toBeGreaterThan(4);
			await expect(page.locator(`[data-port-node="${id}"][data-port-role="incoming"]`)).toHaveCount(
				1,
			);
			await expect(page.locator(`[data-port-node="${id}"][data-port-role="outgoing"]`)).toHaveCount(
				1,
			);
			await expect(page.locator(`[data-reservation-node="${id}"]`)).toContainText('16');
		}
		await expect(page.locator('[data-rail-junctions="j1 j2"]')).toHaveCount(1);
	}
});
