import { expect, type Page, test } from '@playwright/test';

async function documentPointAt(page: Page, clientX: number, clientY: number) {
	return page.locator('[data-graph-stage]').evaluate(
		(stage, point) => {
			const bounds = stage.getBoundingClientRect();
			const transform = getComputedStyle(stage).transform;
			let scale = 1;
			if (transform !== 'none') scale = new DOMMatrixReadOnly(transform).a;
			return {
				x: (point.x - bounds.left) / scale,
				y: (point.y - bounds.top) / scale,
			};
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

async function settleCanvasMotion(page: Page): Promise<void> {
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
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

async function dragSelectionEnvelope(
	page: Page,
	nodeIds: readonly string[],
	shiftKey = false,
	groupId?: string,
): Promise<void> {
	const bounds = await page.locator('[data-graph-stage]').evaluate((stage, ids) => {
		const boxes = ids.map((id) => {
			const node = stage.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
			if (!node) throw new Error(`Missing marquee node: ${id}`);
			return node.getBoundingClientRect();
		});
		return {
			left: Math.min(...boxes.map((box) => box.left)) - 2,
			top: Math.min(...boxes.map((box) => box.top)) - 2,
			right: Math.max(...boxes.map((box) => box.right)) + 2,
			bottom: Math.max(...boxes.map((box) => box.bottom)) + 2,
		};
	}, nodeIds);
	const viewport = page.getByRole('region', { name: 'Canvas viewport' });
	let origin = viewport;
	if (groupId !== undefined) origin = page.locator(`[data-group-id="${groupId}"]`);
	await origin.dispatchEvent('pointerdown', {
		button: 0,
		clientX: bounds.left,
		clientY: bounds.top,
		isPrimary: true,
		pointerId: 71,
		shiftKey,
	});
	await page.evaluate(
		({ right, bottom, shift }) => {
			window.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					clientX: right,
					clientY: bottom,
					isPrimary: true,
					pointerId: 71,
					shiftKey: shift,
				}),
			);
		},
		{ right: bounds.right, bottom: bounds.bottom, shift: shiftKey },
	);
	await expect(page.locator('.selection-envelope')).toBeVisible();
	for (const id of nodeIds)
		await expect(page.locator(`[data-node-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
	await page.evaluate(
		({ right, bottom, shift }) => {
			window.dispatchEvent(
				new PointerEvent('pointerup', {
					bubbles: true,
					button: 0,
					clientX: right,
					clientY: bottom,
					isPrimary: true,
					pointerId: 71,
					shiftKey: shift,
				}),
			);
		},
		{ right: bounds.right, bottom: bounds.bottom, shift: shiftKey },
	);
	await viewport.dispatchEvent('click', {
		clientX: bounds.right,
		clientY: bounds.bottom,
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
		const center = {
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		};
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
		await expect(page.getByRole('button', { name: 'AI for documentary effort' })).toHaveAttribute(
			'aria-haspopup',
			'menu',
		);
	});

	test('zooms around a modified-wheel pointer anchor', async ({ page }) => {
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		const bounds = await viewport.boundingBox();
		if (!bounds) throw new Error('Canvas viewport has no bounds');
		const pointer = {
			x: bounds.x + bounds.width * 0.72,
			y: bounds.y + bounds.height * 0.35,
		};
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
		const panBlank = await blankCanvasPoint(page);
		await page.keyboard.down('Space');
		await page.mouse.move(panBlank.x, panBlank.y);
		await page.mouse.down();
		await page.mouse.move(panBlank.x + 80, panBlank.y + 60, { steps: 4 });
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
		await group.click({
			modifiers: ['Meta'],
			position: { x: 8, y: 8 },
			force: true,
		});
		await expect(node).toHaveAttribute('aria-pressed', 'true');
		await expect(group).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('Escape');
		await expect(node).toHaveAttribute('aria-pressed', 'false');
		await expect(group).toHaveAttribute('aria-pressed', 'false');
	});

	test('offers the floating toolbar for every selected entity kind', async ({ page }) => {
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const group = page.locator('[data-group-id="data-team"]');
		const junction = page.locator('[data-junction-id="word-ui-options"]');
		const relationSelector = '[data-relation-id="data-team-to-ai-content-generation"]';
		await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toHaveCount(0);

		await node.click();
		const nodeBar = page.getByRole('group', { name: 'Node actions' });
		await expect(nodeBar.getByRole('button')).toHaveText(['Edit', 'Supprimer']);

		await group.click({ modifiers: ['Meta'], position: { x: 8, y: 8 }, force: true });
		const selectionBar = page.getByRole('group', { name: 'Selection actions' });
		await expect(selectionBar.getByRole('button')).toHaveText(['Supprimer']);
		await expect(nodeBar).toHaveCount(0);

		await group.click({ position: { x: 8, y: 8 }, force: true });
		const groupBar = page.getByRole('group', { name: 'Group actions' });
		await groupBar.getByRole('button', { name: 'Edit group data-team' }).click();
		const dialog = page.getByRole('dialog', { name: 'Modifier le groupe' });
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);

		await junction.click();
		const junctionBar = page.getByRole('group', { name: 'Junction actions' });
		await expect(junctionBar.getByRole('button')).toHaveText(['Supprimer']);
		await junctionBar
			.getByRole('button', { name: 'Supprimer la jonction word-ui-options', exact: true })
			.click();
		await expect(junction).toHaveCount(0);
		await expect(page.locator('[data-node-id]')).toHaveCount(24);

		const relationPoint = await visibleRelationPoint(page, relationSelector);
		await page.mouse.click(relationPoint.x, relationPoint.y);
		await page
			.getByRole('group', { name: 'Relation actions' })
			.getByRole('button', {
				name: 'Supprimer la relation data-team-to-ai-content-generation',
				exact: true,
			})
			.click();
		await expect(page.locator(relationSelector)).toHaveCount(0);
		await expect(group).toHaveCount(1);
	});

	test('selects nodes with envelopes, composes with Shift, and groups from the floating bar', async ({
		page,
	}) => {
		const first = page.locator('[data-node-id="traceable-edits"]');
		const second = page.locator('[data-node-id="training-roi"]');
		const added = page.locator('[data-node-id="isolated-partner-edits"]');
		const previousGroups = await page.locator('[data-group-id]').count();

		await dragSelectionEnvelope(page, ['traceable-edits', 'training-roi'], false, 'use-cases');
		await expect(first).toHaveAttribute('aria-pressed', 'true');
		await expect(second).toHaveAttribute('aria-pressed', 'true');
		expect(
			await first.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					property: style.transitionProperty,
					duration: style.transitionDuration,
					easing: style.transitionTimingFunction,
				};
			}),
		).toMatchObject({
			property: expect.stringContaining('outline-color'),
			duration: '0.26s',
			easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
		});
		await expect(page.getByRole('group', { name: 'Selection actions' })).toBeVisible();

		await first.click({ modifiers: ['Shift'] });
		await expect(first).toHaveAttribute('aria-pressed', 'false');
		await first.click({ modifiers: ['Shift'] });
		await expect(first).toHaveAttribute('aria-pressed', 'true');

		await dragSelectionEnvelope(page, ['isolated-partner-edits'], true);
		await expect(first).toHaveAttribute('aria-pressed', 'true');
		await expect(second).toHaveAttribute('aria-pressed', 'true');
		await expect(added).toHaveAttribute('aria-pressed', 'true');

		await page.keyboard.press('g');
		await expect(page.locator('[data-group-id]')).toHaveCount(previousGroups + 1);
		await expect(page.getByRole('group', { name: 'Selection actions' })).toHaveCount(0);
		const groupId = await first.getAttribute('data-node-group-id');
		expect(groupId).toBeTruthy();
		expect(await second.getAttribute('data-node-group-id')).toBe(groupId);
		expect(await added.getAttribute('data-node-group-id')).toBe(groupId);
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

	test('Tab leaves the canvas and returns to its last focused entity', async ({ page }) => {
		const transitions = await keyboardTransitions(page);
		const movement = required(
			transitions.find((transition) => transition.target !== transition.source),
			'Missing keyboard navigation step',
		);
		await entityByKey(page, movement.source).focus();
		await page.keyboard.press(movement.code);
		const target = entityByKey(page, movement.target);
		await expect(target).toBeFocused();
		await expect(target).toHaveAttribute('tabindex', '0');
		await expect(page.locator('[data-graph-stage] [tabindex="0"]')).toHaveCount(1);

		await page.keyboard.press('Tab');
		await expect(page.locator('[data-graph-stage] :focus')).toHaveCount(0);
		await page.keyboard.press('Shift+Tab');
		await expect(target).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(page.locator('[data-graph-stage] :focus')).toHaveCount(0);
		await page.keyboard.press('Tab');
		await expect(target).toBeFocused();
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
		const edit = page.getByRole('button', {
			name: 'Edit Markdown for node traceable-edits',
		});
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
		await expect(textarea).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(page.getByRole('button', { name: 'Save' })).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(textarea).toBeFocused();
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
		const edit = page.getByRole('button', {
			name: 'Edit Markdown for node traceable-edits',
		});
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

	test('saves and closes the editor with Shift+Enter', async ({ page }) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.dblclick();
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(textarea).toBeFocused();
		await textarea.fill('Saved and closed from Shift+Enter');

		await page.keyboard.press('Shift+Enter');

		await expect(page.getByRole('dialog', { name: 'Edit Markdown' })).toHaveCount(0);
		await expect(node).toContainText('Saved and closed from Shift+Enter');
		await expect(node).toBeFocused();
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

	test('creates children and siblings from the keyboard while handing off the open editor', async ({
		page,
	}) => {
		const parent = page.locator('[data-node-id="ai-content-generation"]');
		await parent.click();
		await page.keyboard.press('Control+Enter');

		const dialog = page.getByRole('dialog', { name: 'Edit Markdown' });
		const textarea = page.getByRole('textbox', { name: 'Node Markdown' });
		await expect(dialog).toBeVisible();
		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveValue('');
		const firstChildId = await dialog.getAttribute('data-node-markdown-editor');
		if (firstChildId === null || firstChildId === '')
			throw new Error('Created child editor has no node id');
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${firstChildId}"][data-edge-to="ai-content-generation"]`,
			),
		).toHaveCount(1);

		await textarea.fill('First keyboard child');
		await page.keyboard.press('Control+Shift+Enter');
		await expect(dialog).toBeVisible();
		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveValue('');
		const siblingId = await dialog.getAttribute('data-node-markdown-editor');
		if (siblingId === null || siblingId === '')
			throw new Error('Created sibling editor has no node id');
		expect(siblingId).not.toBe(firstChildId);
		await expect(page.locator(`[data-node-id="${firstChildId}"]`)).toContainText(
			'First keyboard child',
		);
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${siblingId}"][data-edge-to="ai-content-generation"]`,
			),
		).toHaveCount(1);
	});

	test('creates a root sibling and a child of a junction from the keyboard', async ({ page }) => {
		const root = page.locator('[data-node-id="reduce-documentary-effort"]');
		await root.click();
		await page.keyboard.press('Control+Shift+Enter');

		const dialog = page.getByRole('dialog', { name: 'Edit Markdown' });
		await expect(dialog).toBeVisible();
		const rootSiblingId = await dialog.getAttribute('data-node-markdown-editor');
		if (rootSiblingId === null || rootSiblingId === '')
			throw new Error('Created root sibling editor has no node id');
		await expect(page.locator(`[data-relation-id][data-edge-from="${rootSiblingId}"]`)).toHaveCount(
			0,
		);

		await page.keyboard.press('Escape');
		await expect(page.locator(`[data-node-id="${rootSiblingId}"]`)).toHaveCount(0);

		const parent = page.locator('[data-node-id="ai-content-generation"]');
		await parent.click();
		await page.keyboard.press('Control+Enter');
		await expect(dialog).toBeVisible();
		const childId = await dialog.getAttribute('data-node-markdown-editor');
		if (childId === null || childId === '') throw new Error('Created child editor has no node id');
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${childId}"][data-edge-to="ai-content-generation"]`,
			),
		).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(page.locator(`[data-node-id="${childId}"]`)).toHaveCount(0);

		const junction = page.locator('[data-junction-id="word-ui-options"]');
		await junction.click();
		await page.keyboard.press('Control+Enter');
		await expect(dialog).toBeVisible();
		const junctionChildId = await dialog.getAttribute('data-node-markdown-editor');
		if (junctionChildId === null || junctionChildId === '')
			throw new Error('Created junction child editor has no node id');
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${junctionChildId}"][data-edge-to="word-ui-options"]`,
			),
		).toHaveCount(1);
	});
});

test('double-clicking a group title edits its title and color', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const group = page.locator('[data-group-id="use-cases"]');
	await expect(group).toContainText('Use cases');

	await group.locator('[data-group-header]').dblclick();

	const dialog = page.getByRole('dialog', { name: 'Modifier le groupe' });
	await expect(dialog).toBeVisible();
	const title = page.getByRole('textbox', { name: 'Titre du groupe' });
	await expect(title).toBeFocused();
	await title.fill('Cas d’usage');
	await page.getByLabel('Couleur personnalisée').fill('#2563eb');
	await page.getByRole('button', { name: 'Enregistrer' }).click();

	await expect(dialog).toHaveCount(0);
	await expect(group).toContainText('Cas d’usage');
	await expect(group).toHaveAttribute('data-group-color', '#2563eb');
});

test('a keyboard child of a selected group is related to the group without becoming its member', async ({
	page,
}) => {
	await page.goto('/examples/ai-documentary-effort');
	const group = page.locator('[data-group-id="data-team"]');
	await group.focus();
	await group.press('Enter');
	await page.keyboard.press('Control+Enter');
	const dialog = page.getByRole('dialog', { name: 'Edit Markdown' });
	await expect(dialog).toBeVisible();
	const childId = await dialog.getAttribute('data-node-markdown-editor');
	if (childId === null || childId === '')
		throw new Error('Created group child editor has no node id');
	await expect(
		page.locator(`[data-relation-id][data-edge-from="${childId}"][data-edge-to="data-team"]`),
	).toHaveCount(1);
	const child = page.locator(`[data-node-id="${childId}"]`);
	const childBox = await child.boundingBox();
	const groupBox = await group.boundingBox();
	if (!childBox || !groupBox) throw new Error('Created group child has no rendered geometry');
	expect(
		childBox.x >= groupBox.x &&
			childBox.y >= groupBox.y &&
			childBox.x + childBox.width <= groupBox.x + groupBox.width &&
			childBox.y + childBox.height <= groupBox.y + groupBox.height,
	).toBe(false);
});

test('double-click creates through a modal; Backspace and the delete action remove nodes', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	const point = await blankCanvasPoint(page);
	await page.mouse.dblclick(point.x, point.y);
	const dialog = page.getByRole('dialog', { name: 'Nouvelle boîte' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('Contenu')).toBeFocused();
	await dialog.getByLabel('Contenu').fill('Nouvelle idée canvas');
	await dialog.getByLabel('Contenu').press('Backspace');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	await dialog.getByLabel('Contenu').fill('Nouvelle idée canvas');
	await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	const node = page.locator('[data-node-id]').filter({ hasText: 'Nouvelle idée canvas' });
	await expect(node).toBeVisible();
	await node.click();
	await node.press('Backspace');
	await expect(node).toHaveCount(0);
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	const existing = page.locator('[data-node-id]').first();
	await existing.click();
	const existingId = await existing.getAttribute('data-node-id');
	await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: `Supprimer le nœud ${existingId}`, exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(23);
});

test('dropping a member on its enclosing group background is a no-op', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	const relations = await page.locator('[data-relation-id]').count();
	const member = page.locator('[data-node-id="traceable-edits"]');
	const group = page.locator('[data-group-id="use-cases"]');
	await expect(member).toHaveAttribute('data-node-group-id', 'use-cases');
	await member.scrollIntoViewIfNeeded();
	const origin = await member.boundingBox();
	const header = await group.locator('[data-group-header]').boundingBox();
	if (!origin || !header) throw new Error('Missing geometry');
	await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
	await page.mouse.down();
	await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2, { steps: 8 });
	await expect(group).not.toHaveAttribute('data-connection-target');
	await page.mouse.up();
	await expect(page.locator('[data-relation-id]')).toHaveCount(relations);
	await expect(page.getByText('Échec du calcul de mise en page')).toHaveCount(0);
});

test('deleting a selected relation preserves its endpoints', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	const before = await page.locator('[data-relation-id]').count();
	const firstId = await page.locator('[data-relation-id]').first().getAttribute('data-relation-id');
	const point = await visibleRelationPoint(page, `[data-relation-id="${firstId}"]`);
	await page.mouse.click(point.x, point.y);
	await page.keyboard.press('Delete');
	await expect(page.locator('[data-relation-id]')).toHaveCount(before - 1);
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
});

test('double-click on group background creates a member; canvas background resets the parent', async ({
	page,
}) => {
	await page.goto('/');
	const group = page.locator('[data-group-id="data-team"]');
	await group.scrollIntoViewIfNeeded();
	await settleCanvasMotion(page);
	const point = await group.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		for (
			let y = Math.max(bounds.top + 40, 60);
			y < Math.min(bounds.bottom - 4, innerHeight);
			y += 8
		) {
			for (
				let x = Math.max(bounds.left + 4, 0);
				x < Math.min(bounds.right - 4, innerWidth);
				x += 8
			) {
				if (document.elementFromPoint(x, y) === element) return { x, y };
			}
		}
		throw new Error('No visible group background');
	});
	await page.mouse.dblclick(point.x, point.y);
	const dialog = page.getByRole('dialog', { name: 'Nouvelle boîte' });
	await dialog.getByLabel('Contenu').fill('Membre créé dans le groupe');
	await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
	const member = page.locator('[data-node-id]').filter({ hasText: 'Membre créé dans le groupe' });
	await expect(member).toBeVisible();
	await settleCanvasMotion(page);
	const background = await blankCanvasPoint(page);
	await page.mouse.dblclick(background.x, background.y);
	await dialog.getByLabel('Contenu').fill('Boîte hors groupe');
	await dialog.getByRole('button', { name: 'Créer', exact: true }).click();
	const outside = page.locator('[data-node-id]').filter({ hasText: 'Boîte hors groupe' });
	await expect(outside).toBeVisible();
	await group.focus();
	await group.press('Enter');
	await group.press('Delete');
	await expect(group).toHaveCount(0);
	await expect(member).toHaveCount(0);
	await expect(outside).toBeVisible();
});
