import { expect, test } from '@playwright/test';

test('the workshop compares real boundary contacts with rejected alternatives', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Contacts de régions' }).click();

	const explorer = page.getByRole('region', { name: 'Contacts aux frontières de régions' });
	const parent = explorer.getByTestId('contact-case-parent-contact');
	await expect(parent).toContainText('Document parent-contact-witness · 6 nœuds · 3 relations');
	const parentValid = parent.getByTestId('contact-panel-parent-contact-validated');
	const parentShared = parent.getByTestId('contact-panel-parent-contact-shared-portal');
	await expect(parentValid.getByTestId('contact-status')).toHaveText('Validé');
	await expect(parentShared.getByTestId('contact-status')).toHaveText('Rejeté');
	await expect(parentShared.getByTestId('contact-validation')).toContainText(
		'intersect without a bridge',
	);
	await expect(parentValid.getByTestId('portal-inside-branch-branch-right')).toHaveCount(1);
	await expect(parentValid.getByTestId('portal-c-to-d-branch-right')).toHaveCount(1);
	await expect(parentValid.getByTestId('owned-c-to-d-branch')).toHaveCount(1);
	expect(await parentValid.locator('svg').getAttribute('viewBox')).toBe(
		await parentShared.locator('svg').getAttribute('viewBox'),
	);

	const grid = explorer.getByTestId('contact-case-grid-contact');
	await expect(grid).toContainText('Document grid-contact-witness · 6 nœuds · 2 relations');
	await expect(grid).toContainText('across-grid croise cette sortie');
	const gridValid = grid.getByTestId('contact-panel-grid-contact-validated');
	const gridDirect = grid.getByTestId('contact-panel-grid-contact-direct-exit');
	const gridCrossing = grid.getByTestId('contact-panel-grid-contact-strict-crossing');
	await expect(gridValid.getByTestId('contact-status')).toHaveText('Validé');
	await expect(gridDirect.getByTestId('contact-validation')).toContainText(
		'crosses foreign node a-source',
	);
	await expect(gridValid.getByTestId('owned-leaves-grid-a')).toHaveCount(1);
	await expect(gridValid.getByTestId('portal-leaves-grid-a')).toHaveCount(1);
	await expect(gridCrossing.getByTestId('contact-status')).toHaveText('Rejeté');
	await expect(gridCrossing.getByTestId('strict-crossing-probe')).toHaveCount(1);
	await expect(gridCrossing).toContainText('hypothèse');
	await expect(explorer).toContainText('l’oracle de pont le valide');
	for (const candidate of [gridDirect, gridCrossing]) {
		expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(
			await candidate.locator('svg').getAttribute('viewBox'),
		);
	}

	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await explorer.screenshot({ path: `${screenshotDirectory}/region-contact-workshop.png` });
	}

	const parentFull = await parentValid.locator('svg').getAttribute('viewBox');
	const gridFull = await gridValid.locator('svg').getAttribute('viewBox');
	const parentZoom = parent.getByTestId('contact-zoom-parent-contact');
	const gridZoom = grid.getByTestId('contact-zoom-grid-contact');
	await parentZoom.click();
	await expect(parentZoom).toHaveAttribute('aria-pressed', 'true');
	const parentFocused = await parentValid.locator('svg').getAttribute('viewBox');
	expect(parentFocused).not.toBe(parentFull);
	expect(parentFocused).toBe(await parentShared.locator('svg').getAttribute('viewBox'));
	expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(gridFull);
	await gridZoom.click();
	await expect(gridZoom).toHaveAttribute('aria-pressed', 'true');
	const gridFocused = await gridValid.locator('svg').getAttribute('viewBox');
	expect(gridFocused).not.toBe(gridFull);
	for (const candidate of [gridDirect, gridCrossing]) {
		expect(await candidate.locator('svg').getAttribute('viewBox')).toBe(gridFocused);
	}
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await explorer.screenshot({
			path: `${screenshotDirectory}/region-contact-workshop-focused.png`,
		});
	}
	await parentZoom.click();
	await expect(parentZoom).toHaveAttribute('aria-pressed', 'false');
	expect(await parentValid.locator('svg').getAttribute('viewBox')).toBe(parentFull);
	await gridZoom.click();
	await expect(gridZoom).toHaveAttribute('aria-pressed', 'false');
	expect(await gridValid.locator('svg').getAttribute('viewBox')).toBe(gridFull);
});

test('the grid allocation workshop explains exact route geometry search', async ({
	page,
}, testInfo) => {
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Allocation de grille', exact: true }).click();

	const explorer = page.getByRole('region', { name: 'Allocation de grille' });
	const twoByTwo = explorer.getByTestId('grid-allocation-case-grid-allocation-2x2');
	const truncated = explorer.getByTestId('grid-allocation-case-grid-allocation-3x2-truncated');
	const noncanonical = explorer.getByTestId(
		'grid-allocation-case-grid-allocation-noncanonical-bus',
	);
	await expect(twoByTwo.getByTestId('grid-allocation-winner')).toContainText('Réaffectation');
	await expect(twoByTwo.locator('svg')).toHaveAttribute('aria-label', /4 cellules/);
	await expect(twoByTwo.getByTestId('grid-allocation-phase-reallocate')).toHaveAttribute(
		'data-exhaustive',
		'true',
	);
	await expect(twoByTwo.getByTestId('grid-allocation-phase-reallocate')).toHaveAttribute(
		'data-truncated',
		'false',
	);
	await expect(twoByTwo.getByTestId('grid-allocation-phase-reallocate')).toContainText(
		'Exhaustive',
	);
	for (const phaseId of ['extra-track', 'bridge']) {
		const phase = twoByTwo.getByTestId(`grid-allocation-phase-${phaseId}`);
		await expect(phase).toContainText('Non tentée');
		await expect(phase).toHaveAttribute('data-exhaustive', 'false');
		await expect(phase).toHaveAttribute('data-truncated', 'false');
	}

	await expect(truncated.getByTestId('grid-allocation-winner')).toContainText('Pont validé');
	await expect(truncated.getByTestId('grid-allocation-phase-reallocate')).toContainText(
		'256 / 2592',
	);
	await expect(truncated.getByTestId('grid-allocation-phase-reallocate')).toHaveAttribute(
		'data-truncated',
		'true',
	);
	await expect(truncated.getByTestId('grid-allocation-phase-extra-track')).toContainText(
		'256 / 11232',
	);
	await expect(truncated.getByTestId('grid-allocation-phase-extra-track')).toHaveAttribute(
		'data-truncated',
		'true',
	);
	await expect(truncated.getByTestId('grid-allocation-phase-bridge')).toContainText('1 / 2592');
	await expect(truncated.getByTestId('grid-allocation-phase-bridge')).toContainText('Retenue');

	await expect(noncanonical.getByTestId('grid-allocation-retained')).toContainText(
		'Bus : a-b → a-d → a-c',
	);

	for (const [card, relationIds] of [
		[twoByTwo, ['a-d']],
		[truncated, ['a-b', 'a-c', 'c-f']],
		[noncanonical, ['a-b', 'a-c', 'a-d']],
	] as const) {
		for (const relationId of relationIds) {
			const track = card.getByTestId(`grid-allocation-track-${relationId}`);
			const route = card.getByTestId(`grid-allocation-route-${relationId}`);
			await expect(track).toBeVisible();
			await expect(route).toBeVisible();
			const legendColor = await track
				.locator('.swatch')
				.evaluate(
					(element) => element.getAttribute('style')?.match(/--track-color:\s*([^;]+)/)?.[1],
				);
			if (legendColor === undefined)
				throw new Error('Missing relation color in the allocation legend.');
			await expect(route).toHaveAttribute('stroke', legendColor.trim());
			const points = await route.getAttribute('points');
			expect(points?.trim().split(/\s+/).length ?? 0).toBeGreaterThan(3);
		}
	}

	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium')
		await explorer.screenshot({
			path: `${screenshotDirectory}/grid-cell-allocation-workshop.png`,
		});
});
