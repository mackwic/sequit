import { expect, type Page, test } from '@playwright/test';

async function documentPointAt(page: Page, clientX: number, clientY: number) {
	return page.locator('[data-graph-stage]').evaluate(
		(stage, point) => {
			const bounds = stage.getBoundingClientRect();
			const transform = getComputedStyle(stage).transform;
			let scale = 1;
			if (transform !== 'none') scale = new DOMMatrixReadOnly(transform).a;
			return { x: (point.x - bounds.left) / scale, y: (point.y - bounds.top) / scale };
		},
		{ x: clientX, y: clientY },
	);
}

test.describe('canvas viewport interactions', () => {
	test('hydrates the root route and renders the graph', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByText('Measuring document…')).toHaveCount(0);
		await expect(page.locator('[data-graph-stage]')).toBeVisible();
		await expect(page.locator('[data-node-id]')).toHaveCount(24);

		await page.getByRole('button', { name: 'Zoom in' }).click();
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%');
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
	});

	test('ships truthful controls and zooms around the viewport center', async ({ page }) => {
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		const bounds = await viewport.boundingBox();
		if (!bounds) throw new Error('Canvas viewport has no bounds');
		const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
		const before = await documentPointAt(page, center.x, center.y);

		await page.getByRole('button', { name: 'Zoom in' }).click();
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%');
		const after = await documentPointAt(page, center.x, center.y);
		expect(Math.abs(after.x - before.x)).toBeLessThan(1);
		expect(Math.abs(after.y - before.y)).toBeLessThan(1);

		await page.getByRole('button', { name: 'Reset zoom' }).click();
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%');
		await expect(page.getByRole('button', { name: 'Select' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page.getByRole('button', { name: 'Add box' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Connect boxes' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'AI for documentary effort' })).toHaveCount(0);
	});

	test('zooms around a modified-wheel pointer anchor', async ({ page }) => {
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		const bounds = await viewport.boundingBox();
		if (!bounds) throw new Error('Canvas viewport has no bounds');
		const pointer = { x: bounds.x + bounds.width * 0.72, y: bounds.y + bounds.height * 0.35 };
		const before = await documentPointAt(page, pointer.x, pointer.y);

		await viewport.dispatchEvent('wheel', {
			clientX: pointer.x,
			clientY: pointer.y,
			ctrlKey: true,
			deltaY: -100,
		});
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%');
		const after = await documentPointAt(page, pointer.x, pointer.y);
		expect(Math.abs(after.x - before.x)).toBeLessThan(1);
		expect(Math.abs(after.y - before.y)).toBeLessThan(1);
	});

	test('retains ordinary scrolling and supports Space drag panning on blank canvas', async ({
		page,
	}) => {
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		const initialScroll = await viewport.evaluate((element) => {
			const left = (element.scrollWidth - element.clientWidth) / 2;
			const top = (element.scrollHeight - element.clientHeight) / 2;
			element.scrollTo(left, top);
			return { left: element.scrollLeft, top: element.scrollTop };
		});
		expect(initialScroll.left).toBeGreaterThan(0);
		expect(initialScroll.top).toBeGreaterThan(0);
		const blank = await viewport.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			for (let y = bounds.top + 24; y < bounds.bottom; y += 24) {
				for (let x = bounds.left + 24; x < bounds.right; x += 24) {
					const target = document.elementFromPoint(x, y);
					if (
						target &&
						element.contains(target) &&
						!target.closest(
							'[data-node-id], [data-group-id], [data-junction-id], [data-relation-id]',
						)
					)
						return { x, y };
				}
			}
			throw new Error('Canvas viewport has no blank point');
		});

		await page.mouse.move(blank.x, blank.y);
		await page.mouse.wheel(0, 60);
		await expect
			.poll(() => viewport.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(initialScroll.top);

		const beforePan = await viewport.evaluate((element) => ({
			left: element.scrollLeft,
			top: element.scrollTop,
		}));
		await page.keyboard.down('Space');
		await page.mouse.move(blank.x, blank.y);
		await page.mouse.down();
		await page.mouse.move(blank.x + 80, blank.y + 60, { steps: 4 });
		await page.mouse.up();
		await page.keyboard.up('Space');
		const afterPan = await viewport.evaluate((element) => ({
			left: element.scrollLeft,
			top: element.scrollTop,
		}));
		expect(afterPan.left).toBeLessThan(beforePan.left);
		expect(afterPan.top).toBeLessThan(beforePan.top);

		await page.getByRole('button', { name: 'Zoom in' }).focus();
		await page.keyboard.press('Space');
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('110%');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
	});
});
