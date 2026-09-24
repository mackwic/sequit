import { expect, test } from '@playwright/test';

import { interiorPassageDocument } from '../../../lib/core/layout/shared-lane-interior-fixture';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('a persisted S | SD | C blocker leaves a monotone passage through the middle lane', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, interiorPassageDocument(true));
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-lane-id]')).toHaveCount(3);
	await expect(page.locator('[data-node-id]')).toHaveCount(2);
	await expect(page.locator('[data-group-id="sd-block"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="request"]')).toHaveCount(1);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	const passage = await page.evaluate(() => {
		const path = document.querySelector<SVGPathElement>('[data-relation-id="request"]');
		const lane = document.querySelector<HTMLElement>('[data-lane-id="SD"]');
		const group = document.querySelector<HTMLElement>('[data-group-id="sd-block"]');
		if (path === null || lane === null || group === null)
			throw new Error('Missing persisted passage, lane, or blocker');
		const transform = path.getScreenCTM();
		if (transform === null) throw new Error('Missing route transform');
		const commands = [
			...(path.getAttribute('d') ?? '').matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g),
		];
		const points = commands.map((command) =>
			new DOMPoint(Number(command[1]), Number(command[2])).matrixTransform(transform),
		);
		if (points.length < 4) throw new Error('Missing route segments');
		const first = points[0];
		const last = points.at(-1);
		if (first === undefined || last === undefined) throw new Error('Missing route terminals');
		const middle = lane.getBoundingClientRect();
		const blocker = group.getBoundingClientRect();
		const crossing = points.find((point, index) => {
			const next = points[index + 1];
			if (next?.y !== point.y) return false;
			return Math.min(point.x, next.x) < middle.left && Math.max(point.x, next.x) > middle.right;
		});
		if (crossing === undefined) throw new Error('No segment crosses the middle lane');
		return {
			firstY: first.y,
			lastY: last.y,
			crossingY: crossing.y,
			blockerBottom: blocker.bottom,
			clearance: 12 * Math.hypot(transform.a, transform.b),
			monotone: points.every((point, index) => {
				const previous = points[index - 1];
				return previous === undefined || point.y <= previous.y;
			}),
		};
	});
	expect(passage.monotone).toBe(true);
	expect(passage.crossingY).toBeLessThan(passage.firstY);
	expect(passage.crossingY).toBeGreaterThan(passage.lastY);
	expect(passage.crossingY).toBeGreaterThanOrEqual(passage.blockerBottom + passage.clearance);
	const screenshot = info.outputPath('persisted-shared-lane-interior-passage.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-shared-lane-interior-passage', {
		path: screenshot,
		contentType: 'image/png',
	});
});
