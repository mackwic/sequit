import { expect, test } from '@playwright/test';

import { persistedGridDocument } from '../../../lib/core/layout/grid-cell-fixture';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('a persisted 2×2 grid renders four independent cells and an exterior cross-cell route', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedGridDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(4);
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	await expect(page.locator('[data-group-id="oversized"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="inside-a"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="across-grid"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	const viewport = page.locator('[data-canvas-viewport]');
	for (let step = 0; step < 3; step += 1)
		await viewport.dispatchEvent('wheel', {
			ctrlKey: true,
			deltaY: 100,
			clientX: 780,
			clientY: 600,
		});
	await expect(page.locator('[data-graph-stage]')).toHaveCSS('transform', /^matrix\(0\.7,/);
	const frames = await page.evaluate(() => {
		const rectangles = new Map<string, DOMRect>();
		for (const id of ['a', 'b', 'c', 'd']) {
			const element = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
			if (element === null) throw new Error(`Missing grid cell ${id}`);
			rectangles.set(id, element.getBoundingClientRect());
		}
		const box = (id: string): DOMRect => {
			const bounds = rectangles.get(id);
			if (bounds === undefined) throw new Error(`Missing bounds for ${id}`);
			return bounds;
		};
		for (const [cellId, endpointIds] of [
			['a', ['a-top', 'a-bottom']],
			['b', ['oversized', 'b']],
			['c', ['c']],
			['d', ['d']],
		] as const) {
			const cell = box(cellId);
			for (const endpointId of endpointIds) {
				const endpoint = document.querySelector<HTMLElement>(
					`[data-node-id="${endpointId}"], [data-group-id="${endpointId}"]`,
				);
				if (endpoint === null) throw new Error(`Missing endpoint ${endpointId}`);
				const bounds = endpoint.getBoundingClientRect();
				if (
					bounds.left <= cell.left ||
					bounds.right >= cell.right ||
					bounds.top <= cell.top ||
					bounds.bottom >= cell.bottom
				)
					throw new Error(`${endpointId} escaped cell ${cellId}`);
			}
		}
		const route = document.querySelector<SVGPathElement>('[data-relation-id="across-grid"]');
		if (route === null) throw new Error('Missing cross-cell route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const length = route.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = route.getPointAtLength((length * sample) / 128);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			for (const id of ['b', 'c']) {
				const bounds = box(id);
				if (
					screen.x > bounds.left + 1 &&
					screen.x < bounds.right - 1 &&
					screen.y > bounds.top + 1 &&
					screen.y < bounds.bottom - 1
				)
					throw new Error(`Cross-cell route entered opaque cell ${id}`);
			}
		}
		return [...rectangles].map(([id, bounds]) => ({
			id,
			x: bounds.x,
			y: bounds.y,
		}));
	});
	expect(frames).toEqual([
		expect.objectContaining({ id: 'a' }),
		expect.objectContaining({ id: 'b' }),
		expect.objectContaining({ id: 'c' }),
		expect.objectContaining({ id: 'd' }),
	]);
	const a = frames.find(({ id }) => id === 'a');
	const b = frames.find(({ id }) => id === 'b');
	const c = frames.find(({ id }) => id === 'c');
	if (a === undefined || b === undefined || c === undefined)
		throw new Error('Missing grid cell positions');
	expect(a.x).toBeLessThan(b.x);
	expect(a.y).toBeLessThan(c.y);
	const screenshot = info.outputPath('persisted-grid-cells.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-cells', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('an unbridged three-route contact reports the current grid diagnostic', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedGridDocument();
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		relations: [
			...source.relations,
			{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
			{ id: 'third-crossing', from: 'a-top', to: 'd' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	const diagnostic = page.locator('[data-layout-diagnostic]');
	await expect(diagnostic).toBeVisible();
	await expect(diagnostic.locator('[data-layout-reason="unknown-region-layout"]')).toBeVisible();
	await expect(diagnostic.locator(`[data-document-id="${room}"]`)).toBeVisible();
	await expect(diagnostic).toContainText(
		'Relations (4) : across-grid, inside-a, second-crossing, third-crossing',
	);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	await expect(page.locator('[data-canvas-overlay]')).toHaveCount(0);
});

test('an unbridged group route reports the current grid diagnostic', async ({ page }, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedGridDocument();
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		relations: [...source.relations, { id: 'group-crossing', from: 'oversized', to: 'd' }],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	const diagnostic = page.locator('[data-layout-diagnostic]');
	await expect(diagnostic).toBeVisible();
	await expect(diagnostic.locator('[data-layout-reason="unknown-region-layout"]')).toBeVisible();
	await expect(diagnostic.locator(`[data-document-id="${room}"]`)).toBeVisible();
	await expect(diagnostic).toContainText('Relations (3) : across-grid, group-crossing, inside-a');
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	await expect(page.locator('[data-canvas-overlay]')).toHaveCount(0);
	const screenshot = info.outputPath('cross-cell-group-contact-diagnostic.png');
	await page.screenshot({ path: screenshot });
	await info.attach('cross-cell-group-contact-diagnostic', {
		path: screenshot,
		contentType: 'image/png',
	});
});
