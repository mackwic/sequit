import { expect, test } from '@playwright/test';

test('the workshop renders the validated four-cell rank four to one proof', async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	await page.goto('/atelier/solveur');
	await page.getByRole('button', { name: 'Grille 2×2' }).click();
	const witness = page.getByRole('region', {
		name: 'Composition de quatre cellules indépendantes',
	});
	await expect(witness.getByTestId('grid-status')).toContainText('Validé · 4 cellules');
	await expect(witness).toContainText('Source A : rang 4');
	await expect(witness).toContainText('Cible D : rang 1');
	await expect(witness.locator('rect.cell')).toHaveCount(4);
	await expect(witness.locator('rect.group')).toHaveCount(1);
	await expect(witness.locator('circle.portal')).toHaveCount(2);
	await expect(witness.getByTestId('grid-cross-route')).toHaveCount(1);
	await witness.locator('svg').evaluate((svg) => {
		const cells = [...svg.querySelectorAll<SVGRectElement>('rect.cell')];
		const upperBottom = Math.max(
			...cells
				.filter((cell) => Number(cell.getAttribute('y')) === Number(cells[0]?.getAttribute('y')))
				.map((cell) => Number(cell.getAttribute('y')) + Number(cell.getAttribute('height'))),
		);
		const lowerTop = Math.max(...cells.map((cell) => Number(cell.getAttribute('y'))));
		const route = svg.querySelector<SVGPolylineElement>('[data-testid="grid-cross-route"]');
		if (route === null) throw new Error('Missing workshop crossing');
		const points = [...route.points].map(({ x, y }) => ({ x, y }));
		if (
			!points.some(
				(point, index) =>
					index > 2 &&
					index < points.length - 4 &&
					point.y === points[index + 1]?.y &&
					point.y > upperBottom &&
					point.y < lowerTop,
			)
		)
			throw new Error('Workshop crossing does not use the reserved horizontal row gap');
	});
	await expect(witness.getByRole('img', { name: /Grille deux par deux/ })).toBeVisible();
	const screenshotDirectory = process.env['SEQUIT_LAYOUT_SCREENSHOT_DIR'];
	if (screenshotDirectory !== undefined && testInfo.project.name === 'chromium') {
		await page.screenshot({
			path: `${screenshotDirectory}/grid-cells-rank-4-to-1.png`,
			fullPage: true,
		});
	}
});
