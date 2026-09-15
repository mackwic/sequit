import { expect, test } from '@playwright/test';

const animatedEntities = [
	{
		selector: '[data-node-id="reduce-documentary-effort"]',
		properties: ['left', 'top', 'width', 'height', 'border-color'],
	},
	{
		selector: '[data-group-id="data-team"]',
		properties: ['left', 'top', 'width', 'height'],
	},
	{
		selector: '[data-junction-id="word-ui-options"]',
		properties: ['left', 'top', 'width', 'height'],
	},
	{
		selector: '[data-rendered-relation-id="data-team-to-ai-content-generation"]',
		properties: ['d', 'stroke', 'stroke-width'],
	},
];

test.beforeEach(async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
});

test('eases visual property changes for every canvas entity kind', async ({ page }) => {
	for (const { selector, properties } of animatedEntities) {
		const motion = await page.locator(selector).evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				duration: style.transitionDuration,
				easing: style.transitionTimingFunction,
				properties: style.transitionProperty,
			};
		});
		expect(motion.duration).toBe('0.26s');
		expect(motion.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
		for (const property of properties) expect(motion.properties.split(', ')).toContain(property);
	}
});

test('removes canvas motion when reduced motion is requested', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });

	for (const { selector } of animatedEntities) {
		await expect
			.poll(() =>
				page.locator(selector).evaluate((element) => getComputedStyle(element).transitionDuration),
			)
			.toBe('0s');
	}
});
