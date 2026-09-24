import { expect, test } from '@playwright/test';

import { defined, LayoutPolicy } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	depthTwoRegionDocument,
	persistedDepthTwoRegionDocument,
} from '../../../lib/core/layout/nested-region-fixture';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('a persisted depth-three incident crosses every owning boundary', async ({ page }, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const original = depthTwoRegionDocument();
	const c = defined(original.nodes.find(({ id }) => id === 'c'));
	const source = persistedDepthTwoRegionDocument({
		...original,
		relations: [
			defined(original.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'deep-to-right', from: 'c', to: 'd' },
		],
	});
	const scenario = {
		...source,
		regionPresentation: {
			...source.regionPresentation,
			regions: [
				...source.regionPresentation.regions,
				{
					id: 'deep-left',
					parentId: 'branch-right',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'deep-right',
					parentId: 'branch-right',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: [
			...source.nodes.map((node) => {
				if (node.id === 'c') return { ...node, regionId: 'deep-left' };
				return node;
			}),
			{
				...c,
				id: 'f',
				markdown: 'F\n',
				layoutOrder: orderKey('a6'),
				regionId: 'deep-right',
			},
		],
	};
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, scenario);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(8);
	await expect(page.locator('[data-node-id]')).toHaveCount(7);
	await expect(page.locator('[data-relation-id="deep-to-right"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	await page.evaluate(() => {
		const bounds = (id: string): DOMRect => {
			const region = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
			if (region === null) throw new Error(`Missing region ${id}`);
			return region.getBoundingClientRect();
		};
		const parent = bounds('branch-right');
		for (const id of ['deep-left', 'deep-right']) {
			const child = bounds(id);
			if (
				child.left <= parent.left ||
				child.right >= parent.right ||
				child.top <= parent.top ||
				child.bottom >= parent.bottom
			)
				throw new Error(`${id} escaped branch-right`);
		}
		const route = document.querySelector<SVGPathElement>('[data-relation-id="deep-to-right"]');
		if (route === null) throw new Error('Missing depth-three route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const length = route.getTotalLength();
		for (const id of ['middle', 'far-right', 'deep-right']) {
			const frame = bounds(id);
			for (let sample = 0; sample <= 128; sample += 1) {
				const point = route.getPointAtLength((length * sample) / 128);
				const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				if (
					screen.x > frame.left + 1 &&
					screen.x < frame.right - 1 &&
					screen.y > frame.top + 1 &&
					screen.y < frame.bottom - 1
				)
					throw new Error(`Depth-three route entered opaque region ${id}`);
			}
		}
	});
	const viewport = page.locator('[data-canvas-viewport]');
	for (let step = 0; step < 5; step += 1)
		await viewport.dispatchEvent('wheel', {
			ctrlKey: true,
			deltaY: 100,
			clientX: 780,
			clientY: 600,
		});
	await expect(page.locator('[data-graph-stage]')).toHaveCSS('transform', /^matrix\(0\.5,/);
	const screenshot = info.outputPath('nested-region-depth-three.png');
	await page.screenshot({ path: screenshot });
	await info.attach('nested-region-depth-three', { path: screenshot, contentType: 'image/png' });
});
