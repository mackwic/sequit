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

async function blankCanvasPoint(page: Page) {
	return page.getByRole('region', { name: 'Canvas viewport' }).evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		for (let y = bounds.top + 24; y < bounds.bottom; y += 24) {
			for (let x = bounds.left + 24; x < bounds.right; x += 24) {
				const target = document.elementFromPoint(x, y);
				if (
					target &&
					element.contains(target) &&
					!target.closest('[data-node-id], [data-group-id], [data-junction-id], [data-relation-id]')
				)
					return { x, y };
			}
		}
		throw new Error('Canvas viewport has no blank point');
	});
}

async function visibleRelationPoint(page: Page, selector: string) {
	const relation = page.locator(selector);
	await relation.scrollIntoViewIfNeeded();
	return relation.evaluate((path) => {
		if (!(path instanceof SVGPathElement)) throw new Error('Relation target is not an SVG path');
		const matrix = path.getScreenCTM();
		if (!matrix) throw new Error('Relation target has no screen transform');
		const length = path.getTotalLength();
		for (let index = 0; index <= 40; index += 1) {
			const point = path.getPointAtLength((length * index) / 40);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			if (document.elementFromPoint(screen.x, screen.y) === path)
				return { x: screen.x, y: screen.y };
		}
		throw new Error('Relation has no visible hit-target point');
	});
}

function entityByKey(page: Page, key: string) {
	return page.locator(`[data-canvas-entity-key=${JSON.stringify(key)}]`);
}

function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

interface KeyboardTransition {
	readonly source: string;
	readonly code: string;
	readonly target: string;
}

async function keyboardTransitions(page: Page): Promise<readonly KeyboardTransition[]> {
	return page.locator('[data-graph-stage]').evaluate((stage) => {
		const codes = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
		const transitions: KeyboardTransition[] = [];
		const entities = [
			...stage.querySelectorAll<HTMLElement | SVGElement>('[data-canvas-entity-key]'),
		];
		for (const entity of entities) {
			const source = entity.getAttribute('data-canvas-entity-key');
			if (source === null) continue;
			for (const code of codes) {
				entity.focus();
				entity.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code, key: code }));
				const target = document.activeElement?.getAttribute('data-canvas-entity-key') ?? source;
				transitions.push({ source, code, target });
			}
		}
		return transitions;
	});
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
		const blank = await blankCanvasPoint(page);

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

test.describe('accessible canvas selection', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
	});

	test('selects every entity kind by pointer and clears only on blank canvas', async ({ page }) => {
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const group = page.locator('[data-group-id="data-team"]');
		const junction = page.locator('[data-junction-id="word-ui-options"]');
		const relation = page.locator('[data-relation-id="data-team-to-ai-content-generation"]');

		await node.click();
		await expect(node).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByRole('status')).toHaveText('node reduce-documentary-effort selected.');

		await group.click({ position: { x: 8, y: 8 }, force: true });
		await expect(node).toHaveAttribute('aria-pressed', 'false');
		await expect(group).toHaveAttribute('aria-pressed', 'true');

		await junction.click();
		await expect(group).toHaveAttribute('aria-pressed', 'false');
		await expect(junction).toHaveAttribute('aria-pressed', 'true');

		const relationPoint = await visibleRelationPoint(
			page,
			'[data-relation-id="data-team-to-ai-content-generation"]',
		);
		await page.mouse.click(relationPoint.x, relationPoint.y);
		await expect(junction).toHaveAttribute('aria-pressed', 'false');
		await expect(relation).toHaveAttribute('aria-pressed', 'true');

		const blank = await blankCanvasPoint(page);
		await page.mouse.click(blank.x, blank.y);
		await expect(relation).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByRole('status')).toHaveText('Selection cleared.');
	});

	test('supports additive mixed selection and Escape cancellation', async ({ page }) => {
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const group = page.locator('[data-group-id="data-team"]');

		await node.click();
		await group.click({ modifiers: ['Meta'], position: { x: 8, y: 8 }, force: true });
		await expect(node).toHaveAttribute('aria-pressed', 'true');
		await expect(group).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('Escape');
		await expect(node).toHaveAttribute('aria-pressed', 'false');
		await expect(group).toHaveAttribute('aria-pressed', 'false');
	});

	test('keeps keyboard focus visible and arbitrates Space away from panning', async ({ page }) => {
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const group = page.locator('[data-group-id="data-team"]');
		const junction = page.locator('[data-junction-id="word-ui-options"]');
		const relation = page.locator('[data-relation-id="data-team-to-ai-content-generation"]');
		for (const entity of [node, group, junction, relation]) {
			await entity.focus();
			await expect(entity).toBeFocused();
			const before = await viewport.evaluate((element) => ({
				left: element.scrollLeft,
				top: element.scrollTop,
			}));
			await page.keyboard.press('Space');
			await expect(entity).toHaveAttribute('aria-pressed', 'true');
			expect(
				await entity.evaluate((element) => {
					const style = getComputedStyle(element);
					return style.outlineStyle !== 'none' || style.stroke !== 'rgba(0, 0, 0, 0)';
				}),
			).toBe(true);
			expect(
				await viewport.evaluate((element) => ({
					left: element.scrollLeft,
					top: element.scrollTop,
				})),
			).toEqual(before);
		}
	});

	test('tabs through nodes in top-to-bottom flow and wraps', async ({ page }) => {
		const first = page.locator('[data-node-id="alcoa-plus"]');
		const second = page.locator('[data-node-id="preserve-partner-content"]');
		await first.focus();

		const order: string[] = [];
		for (let index = 0; index < 24; index += 1) {
			const key = await page.locator(':focus').getAttribute('data-canvas-entity-key');
			if (key === null) throw new Error(`Missing focused node at Tab index ${index}`);
			order.push(key);
			await page.keyboard.press('Tab');
		}

		expect(new Set(order).size).toBe(24);
		expect(order.every((key) => key.startsWith('node:'))).toBe(true);
		expect(order[0]).toBe('node:alcoa-plus');
		expect(order[1]).toBe('node:preserve-partner-content');
		await expect(first).toBeFocused();
		await expect(first).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('Tab');
		await expect(second).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(first).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(entityByKey(page, required(order.at(-1), 'Missing final Tab node'))).toBeFocused();
	});

	test('uses every arrow direction without wrapping and reaches junctions and relations', async ({
		page,
	}) => {
		const transitions = await keyboardTransitions(page);
		const codes = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];

		for (const code of codes) {
			const movement = transitions.find(
				(transition) => transition.code === code && transition.target !== transition.source,
			);
			if (movement === undefined) throw new Error(`No ${code} movement found`);
			await entityByKey(page, movement.source).focus();
			await page.keyboard.press(code);
			await expect(entityByKey(page, movement.target)).toBeFocused();
			await expect(entityByKey(page, movement.target)).toHaveAttribute('aria-pressed', 'true');

			const edge = transitions.find(
				(transition) => transition.code === code && transition.target === transition.source,
			);
			if (edge === undefined) throw new Error(`No ${code} edge found`);
			const edgeEntity = entityByKey(page, edge.source);
			await edgeEntity.click({ force: true });
			await edgeEntity.focus();
			await page.keyboard.press(code);
			await expect(edgeEntity).toBeFocused();
			await expect(edgeEntity).toHaveAttribute('aria-pressed', 'true');
		}

		for (const targetKind of ['junction', 'relation']) {
			const movement = transitions.find(
				(transition) =>
					transition.target !== transition.source && transition.target.startsWith(`${targetKind}:`),
			);
			if (movement === undefined) throw new Error(`No arrow movement to a ${targetKind} found`);
			await entityByKey(page, movement.source).focus();
			await page.keyboard.press(movement.code);
			await expect(entityByKey(page, movement.target)).toBeFocused();
			await expect(entityByKey(page, movement.target)).toHaveAttribute('aria-pressed', 'true');
		}

		expect(
			transitions.some(
				(transition) =>
					transition.target !== transition.source && transition.target.startsWith('group:'),
			),
		).toBe(false);
	});

	test('keeps hidden measurement copies inert and out of the tab order', async ({ page }) => {
		const measuredNodes = page.locator('[data-measure-node]');

		await expect(measuredNodes).toHaveCount(24);
		await expect(measuredNodes.first()).not.toHaveAttribute('role', /.+/);
		await expect(measuredNodes.first()).not.toHaveAttribute('tabindex', /.+/);
		await expect(measuredNodes.first()).not.toHaveAttribute('aria-pressed', /.+/);
		await expect(page.locator('.measurement-layer')).toHaveAttribute('aria-hidden', 'true');
	});
});

test.describe('resilient modal Markdown editing', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
	});

	test('opens an accessible modal, keeps draft changes local, and restores focus on Cancel', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		const measured = page.locator('[data-measure-node="traceable-edits"]');
		await node.click();
		const edit = page.getByRole('button', { name: 'Edit Markdown for node traceable-edits' });
		await expect(edit).toBeVisible();
		const nodeBounds = await node.boundingBox();
		if (!nodeBounds) throw new Error('Selected node has no bounds');

		await edit.click();
		const dialog = page.getByRole('dialog', { name: 'Edit Markdown' });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveValue('ALCOA+: All edits needs to be tracable\n');
		await expect(dialog).toContainText('Editing node traceable-edits.');

		await textarea.fill('A much longer local draft that must not remeasure the graph.\n'.repeat(8));
		await expect(measured).toContainText('ALCOA+: All edits needs to be tracable');
		await expect(measured).not.toContainText('A much longer local draft');
		expect(await node.boundingBox()).toEqual(nodeBounds);
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
		await page.keyboard.press('Tab');
		expect(
			await dialog.evaluate(
				(element) => element === document.activeElement || element.contains(document.activeElement),
			),
		).toBe(true);
		await page.getByRole('button', { name: 'Cancel' }).click();

		await expect(dialog).toHaveCount(0);
		await expect(node).toBeFocused();
		await expect(node).toContainText('ALCOA+: All edits needs to be tracable');
		await expect(edit).toBeVisible();
	});

	test('saves through reprojection and keeps the Floating UI bar stable during rapid scroll and zoom', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.dblclick();
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(textarea).toBeFocused();
		const replacement = [
			'Saved through the typed document command.',
			'This longer value changes intrinsic layout.',
			'The accepted overlay must follow the node.',
		].join('\n');
		await textarea.fill(replacement);
		await page.getByRole('button', { name: 'Save' }).click();

		await expect(page.locator('[data-node-markdown-editor="traceable-edits"]')).toHaveCount(0);
		await expect(node).toContainText('Saved through the typed document command.');
		await expect(node).toBeFocused();
		const edit = page.getByRole('button', { name: 'Edit Markdown for node traceable-edits' });
		await expect(edit).toBeVisible();
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		await viewport.evaluate((element) => {
			for (let index = 0; index < 30; index += 1) {
				element.scrollTo(index * 17, index * 23);
			}
		});
		for (let index = 0; index < 4; index += 1) {
			await page.getByRole('button', { name: 'Zoom in' }).click();
		}
		await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('140%');
		await node.scrollIntoViewIfNeeded();
		await expect
			.poll(async () => {
				const nodeBounds = await node.boundingBox();
				const barBounds = await page.getByRole('group', { name: 'Node actions' }).boundingBox();
				if (!nodeBounds || !barBounds) return Number.POSITIVE_INFINITY;
				const verticalGap = Math.min(
					Math.abs(nodeBounds.y - (barBounds.y + barBounds.height)),
					Math.abs(barBounds.y - (nodeBounds.y + nodeBounds.height)),
				);
				return verticalGap;
			})
			.toBeLessThanOrEqual(12);
	});

	test('starts from Enter and Escape preserves the unchanged document value', async ({ page }) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.focus();
		await page.keyboard.press('Enter');
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(textarea).toBeFocused();
		await textarea.fill('Draft cancelled from Escape');

		await page.keyboard.press('Escape');

		await expect(textarea).toHaveCount(0);
		await expect(node).toBeFocused();
		await expect(node).toContainText('ALCOA+: All edits needs to be tracable');
	});

	test('contains keyboard focus and remains usable at a narrow viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 640 });
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.dblclick();
		const dialog = page.getByRole('dialog', { name: 'Edit Markdown' });
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(dialog).toBeVisible();
		await expect(textarea).toBeFocused();
		const bounds = await dialog.boundingBox();
		if (!bounds) throw new Error('Narrow Markdown dialog has no bounds');
		expect(bounds.x).toBeGreaterThanOrEqual(15);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(345);

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(node).toBeFocused();
	});
});
