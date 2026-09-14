import { expect, test } from '@playwright/test';

import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('a shared document remains readable on a phone without page overflow', async ({ page }) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes);
	await page.goto(`/atelier/collaboration?room=${room}&name=Lecture`);
	await expect(page.locator('[data-node-id="A"]')).toBeVisible();
	await expect(page.locator('[data-relation-id]')).toHaveCount(1);
	await expect(page.locator('[data-node-id="A"]')).toContainText('Alpha');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	const viewport = await page.locator('[data-canvas-viewport]').boundingBox();
	expect(viewport?.width).toBeGreaterThan(300);
	await page.locator('[data-node-id="A"]').tap();
	await expect(page.locator('[data-node-id="A"]')).toHaveAttribute('aria-pressed', 'true');
});
