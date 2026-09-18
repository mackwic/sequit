import { expect, test } from '@playwright/test';

const cases = [
	{ id: 'default-ports', boxes: 3, previews: 1 },
	{ id: 'narrow-ports', boxes: 4, previews: 1 },
	{ id: 'wide-ports', boxes: 4, previews: 1 },
	{ id: 'asymmetric-ports', boxes: 7, previews: 1 },
	{ id: 'local-rails', boxes: 6, previews: 2 },
	{ id: 'shared-port', boxes: 5, previews: 1 },
	{ id: 'forced-crossing-rails', boxes: 4, previews: 1 },
	{ id: 'reused-rail', boxes: 6, previews: 1 },
	{ id: 'released-rails-ports', boxes: 4, previews: 2 },
];

for (const { id, boxes, previews } of cases) {
	test(`renders the executable ${id} specification in every direction`, async ({ page }) => {
		await page.goto('/atelier/tests-visuels');
		await page.getByRole('searchbox', { name: 'Rechercher un scénario' }).fill(id);
		await page
			.getByRole('navigation', { name: 'Scénarios d’assertions visuelles' })
			.getByRole('button')
			.click();
		await expect(page.locator('.scenario-identity')).toContainText(id);
		for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
			await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
			await expect(page.getByRole('img', { name: 'Géométrie du scénario' })).toHaveCount(previews);
			await expect(page.locator('[data-box-id]')).toHaveCount(boxes * previews);
			await expect(page.getByRole('status')).toContainText('Réussi');
			await expect(page.getByRole('status')).not.toContainText(/TypeError|undefined|NaN/);
		}
		if (id === 'released-rails-ports') {
			await expect(
				page.getByRole('heading', {
					name: 'Avant : quatre relations et un croisement obligé',
				}),
			).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Situation à vérifier' })).toBeVisible();
			await page.screenshot({
				path: '/tmp/sequit-ports-comparison.png',
				fullPage: true,
			});
		}
	});
}

test('presents structured assertion failures on a narrow viewport', async ({ page }) => {
	await page.setViewportSize({ width: 375, height: 900 });
	// Deliberately fail a real route assertion to test diagnostic rendering, independently of engine defects.
	await page.route(
		/\/tests\/scenarios\/visual\/routing\/narrow-ports\.scenario\.ts(?:\?|$)/,
		async (route) => {
			const response = await route.fetch();
			let body = await response.text();
			if (!new URL(route.request().url()).searchParams.has('raw')) {
				body +=
					"\nscenario.assert = (layout) => { AssertLayout(layout).route('a-to-c').isStraightAlong('x'); };\n";
			}
			await route.fulfill({ response, body });
		},
	);
	await page.goto('/atelier/tests-visuels/narrow-ports');
	const verdict = page.getByRole('status');
	await expect(verdict).toContainText('Échec du scénario');
	await expect(verdict).toContainText('Route "a-to-c"');
	await expect(verdict.locator('dt')).toHaveText(['Attendu', 'Observé']);
	await expect(verdict.locator('dd').first()).toHaveText('un segment rectiligne sur x');
	await expect(verdict.locator('dd').last()).toContainText('1 segments');
	await page.getByRole('button', { name: 'Réexécuter le scénario' }).click();
	await expect(verdict.locator('dt')).toHaveText(['Attendu', 'Observé']);
	const failedRoute = page.locator('[data-failed-route="true"]');
	await expect(failedRoute).toHaveCount(1);
	await expect(failedRoute.locator('path')).toHaveAttribute('data-rendered-relation-id', 'a-to-c');
	await expect(failedRoute.locator('path')).toHaveCSS('stroke', 'rgb(180, 35, 24)');
	await expect(page.locator('[data-box-id="b"] rect')).not.toHaveCSS('stroke', 'rgb(180, 35, 24)');
	await page.locator('.visual-test').screenshot({ path: '/tmp/sequit-runner-error.png' });
});

test('groups visual settings below the rendered canvas', async ({ page }) => {
	await page.goto('/atelier/tests-visuels/narrow-ports');
	const settings = page.getByRole('group', { name: 'Réglages du contrôle visuel' });
	await expect(settings.getByRole('combobox', { name: 'Direction', exact: true })).toBeVisible();
	await expect(settings.getByRole('combobox', { name: 'Bias', exact: true })).toBeVisible();
	const guides = settings.getByRole('checkbox', { name: 'Afficher les centres et coordonnées' });
	await expect(guides).toBeVisible();
	const canvas = page.getByRole('img', { name: 'Géométrie du scénario' });
	const canvasBounds = await canvas.boundingBox();
	const settingsBounds = await settings.boundingBox();
	expect(canvasBounds).not.toBeNull();
	expect(settingsBounds).not.toBeNull();
	expect(settingsBounds?.y).toBeGreaterThan((canvasBounds?.y ?? 0) + (canvasBounds?.height ?? 0));
	await guides.check();
	await expect(page.locator('[data-center-guide]')).toHaveCount(4);
});

test('inspects reservations without changing geometry and preserves the preference', async ({
	page,
}) => {
	await page.goto('/atelier/tests-visuels/narrow-ports');
	await expect(page.getByRole('status')).toContainText('Réussi');
	const paths = page.locator('[data-rendered-relation-id]');
	const original = await paths.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute('d')),
	);
	const toggle = page.getByRole('checkbox', { name: 'Afficher les rails et les ports' });
	await expect(page.locator('[data-port-node]')).toHaveCount(0);
	await toggle.check();
	for (const direction of ['top-to-bottom', 'bottom-to-top', 'left-to-right', 'right-to-left']) {
		await page.getByRole('combobox', { name: 'Direction', exact: true }).selectOption(direction);
		await expect(page.locator('[data-port-node]')).toHaveCount(8);
		await expect(page.locator('[data-reserved-rail]')).toHaveCount(3);
		await expect(page.locator('[data-content-outline]')).toHaveCount(4);
		await expect(page.locator('[data-reservation-node="a"]')).toContainText('+16');
		await expect(page.getByRole('status')).toContainText('Réussi');
	}
	await page
		.getByRole('combobox', { name: 'Direction', exact: true })
		.selectOption('top-to-bottom');
	expect(
		await paths.evaluateAll((elements) => elements.map((element) => element.getAttribute('d'))),
	).toEqual(original);
	await page.reload();
	await expect(toggle).toBeChecked();
	await page.setViewportSize({ width: 375, height: 900 });
	await expect(page.getByRole('region', { name: 'Réservations de routage' })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
	await page.locator('.visual-test').screenshot({ path: '/tmp/sequit-reservations-mobile.png' });
	await page.goto('/atelier/tests-visuels/wide-ports');
	await expect(page.locator('[data-reservation-node="a"]')).toContainText('+0');
	await page.goto('/atelier/tests-visuels/released-rails-ports');
	await expect(page.getByRole('region', { name: 'Réservations de routage' })).toHaveCount(2);
	await toggle.uncheck();
	await expect(page.locator('[data-port-node]')).toHaveCount(0);
});
