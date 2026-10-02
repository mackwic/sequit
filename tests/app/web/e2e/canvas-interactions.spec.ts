import { expect, type Locator, type Page, test } from '@playwright/test';

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

/** A double-click types a box in place; its dialog opens from the selection with E. */
async function openBoxDialog(page: Page, node: Locator): Promise<void> {
	await node.click();
	await page.keyboard.press('e');
}

/** The box being typed in place: it shows, has the focus, and gives the id the box will have. */
async function typedBox(page: Page) {
	const draft = page.locator('[data-node-draft]');
	const content = draft.getByRole('textbox', { name: 'Contenu de la nouvelle boîte' });
	await expect(content).toBeFocused();
	const id = await draft.getAttribute('data-node-draft');
	if (id === null || id === '') throw new Error('The box being typed has no id');
	return { draft, content, id };
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

		await page.getByRole('button', { name: 'Zoom avant' }).click();
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('110%');
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

		await page.getByRole('button', { name: 'Zoom avant' }).click();
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('110%');
		const after = await documentPointAt(page, center.x, center.y);
		expect(Math.abs(after.x - before.x)).toBeLessThan(1);
		expect(Math.abs(after.y - before.y)).toBeLessThan(1);

		await page.getByRole('button', { name: 'Réinitialiser le zoom' }).click();
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('100%');
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
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('110%');
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

		await page.getByRole('button', { name: 'Zoom avant' }).focus();
		await page.keyboard.press('Space');
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('110%');
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

	test('toggles a relation with Shift, like every other entity kind', async ({ page }) => {
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const relationSelector = '[data-relation-id="data-team-to-ai-content-generation"]';
		const relation = page.locator(relationSelector);

		await node.click();
		const point = await visibleRelationPoint(page, relationSelector);
		await page.keyboard.down('Shift');
		await page.mouse.click(point.x, point.y);
		await expect(node).toHaveAttribute('aria-pressed', 'true');
		await expect(relation).toHaveAttribute('aria-pressed', 'true');

		await page.mouse.click(point.x, point.y);
		await page.keyboard.up('Shift');
		await expect(node).toHaveAttribute('aria-pressed', 'true');
		await expect(relation).toHaveAttribute('aria-pressed', 'false');
	});

	test('offers the floating toolbar for every selected entity kind', async ({ page }) => {
		const node = page.locator('[data-node-id="reduce-documentary-effort"]');
		const group = page.locator('[data-group-id="data-team"]');
		const junction = page.locator('[data-junction-id="word-ui-options"]');
		const relationSelector = '[data-relation-id="data-team-to-ai-content-generation"]';
		await expect(page.getByRole('button', { name: 'Supprimer', exact: true })).toHaveCount(0);

		await node.click();
		const nodeBar = page.getByRole('group', { name: 'Actions du nœud' });
		await expect(nodeBar.getByRole('button')).toHaveText([
			/Créer un enfant/,
			/Propriétés…/,
			/Supprimer/,
		]);
		// Every action shows its key, as in a dialog.
		await expect(nodeBar.locator('kbd')).toHaveText(['C', 'E', /^(⌫|Suppr)$/]);

		await group.click({ modifiers: ['Meta'], position: { x: 8, y: 8 }, force: true });
		const selectionBar = page.getByRole('group', { name: 'Actions de la sélection' });
		await expect(selectionBar.getByRole('button')).toHaveText([/Supprimer/]);
		await expect(nodeBar).toHaveCount(0);

		await group.click({ position: { x: 8, y: 8 }, force: true });
		const groupBar = page.getByRole('group', { name: 'Actions du groupe' });
		await groupBar.getByRole('button', { name: 'Propriétés du groupe data-team' }).click();
		const dialog = page.getByRole('dialog', { name: 'Propriétés du groupe' });
		await expect(dialog).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);

		await junction.click();
		const junctionBar = page.getByRole('group', { name: 'Actions de la jonction' });
		await expect(junctionBar.getByRole('button')).toHaveText([
			/Créer un enfant/,
			/Propriétés…/,
			/Supprimer/,
		]);
		await junctionBar
			.getByRole('button', { name: 'Supprimer la jonction word-ui-options', exact: true })
			.click();
		await expect(junction).toHaveCount(0);
		await expect(page.locator('[data-node-id]')).toHaveCount(24);

		const relationPoint = await visibleRelationPoint(page, relationSelector);
		await page.mouse.click(relationPoint.x, relationPoint.y);
		await page
			.getByRole('group', { name: 'Actions de la relation' })
			.getByRole('button', {
				name: 'Supprimer la relation data-team-to-ai-content-generation',
				exact: true,
			})
			.click();
		await expect(page.locator(relationSelector)).toHaveCount(0);
		await expect(group).toHaveCount(1);
	});

	test('inserts a junction on a relation with J, names its operator, and edits it with E', async ({
		page,
	}) => {
		const relationSelector = '[data-relation-id="data-team-to-ai-content-generation"]';
		const relationCount = await page.locator('[data-relation-id]').count();
		const relationPoint = await visibleRelationPoint(page, relationSelector);
		await page.mouse.click(relationPoint.x, relationPoint.y);
		const relationBar = page.getByRole('group', { name: 'Actions de la relation' });
		await expect(relationBar.getByRole('button')).toHaveText([/Jonction/, /Supprimer/]);
		await page.keyboard.press('j');

		// The junction replaces the relation and opens its dialog with the default operator.
		const dialog = page.getByRole('dialog', { name: 'Opérateur de la jonction' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('radio', { name: 'OU exclusif' })).toBeChecked();
		await expect(dialog.getByRole('radio', { name: 'OU exclusif' })).toBeFocused();
		await expect(page.locator(relationSelector)).toHaveCount(0);
		await expect(page.locator('[data-junction-id]')).toHaveCount(2);
		await expect(page.locator('[data-relation-id]')).toHaveCount(relationCount + 1);
		const junction = page.locator('[data-junction-id]:not([data-junction-id="word-ui-options"])');
		await expect(junction).toHaveAttribute('aria-pressed', 'true');
		const junctionId = await junction.getAttribute('data-junction-id');
		await expect(
			page.locator(`[data-relation-id][data-edge-from="data-team"][data-edge-to="${junctionId}"]`),
		).toHaveCount(1);
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${junctionId}"][data-edge-to="ai-content-generation"]`,
			),
		).toHaveCount(1);

		await dialog.getByRole('radio', { name: 'ET' }).check();
		await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await expect(junction.locator('[data-junction-symbol="and"]')).toHaveCount(1);

		// E reopens the dialog on the selected junction; cancelling keeps the operator.
		await junction.click();
		await page.keyboard.press('e');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('radio', { name: 'ET' })).toBeChecked();
		await dialog.getByRole('radio', { name: 'OU', exact: true }).check();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(junction.locator('[data-junction-symbol="and"]')).toHaveCount(1);

		// Double-clicking the junction edits it; Ctrl/Cmd+Enter saves.
		await junction.dblclick();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('radio', { name: 'OU', exact: true }).check();
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(dialog).toHaveCount(0);
		await expect(junction.locator('[data-junction-symbol="or"]')).toHaveCount(1);
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
		await expect(page.getByRole('group', { name: 'Actions de la sélection' })).toBeVisible();

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
		await expect(page.getByRole('group', { name: 'Actions de la sélection' })).toHaveCount(0);
		const groupId = await first.getAttribute('data-node-group-id');
		expect(groupId).toBeTruthy();
		expect(await second.getAttribute('data-node-group-id')).toBe(groupId);
		expect(await added.getAttribute('data-node-group-id')).toBe(groupId);

		// Grouping opens the dialog to name the group; the default name stays on cancel.
		const naming = page.getByRole('dialog', { name: 'Nommer le groupe' });
		await expect(naming).toBeVisible();
		const title = naming.getByRole('textbox', { name: 'Titre du groupe' });
		await expect(title).toBeFocused();
		await expect(title).toHaveValue('Groupe');
		await title.fill('Pistes');
		await naming.getByRole('button', { name: 'Enregistrer', exact: true }).click();
		await expect(naming).toHaveCount(0);
		const group = page.locator(`[data-group-id="${groupId}"]`);
		await expect(group).toContainText('Pistes');
		await expect(group).toHaveAttribute('aria-pressed', 'true');

		// Folding hides the members and keeps the group; unfolding brings them back.
		const nodeCount = await page.locator('[data-node-id]').count();
		await page.getByRole('button', { name: 'Replier le groupe Pistes' }).click();
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount - 3);
		await expect(group).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'Déplier le groupe Pistes' })).toBeVisible();
		await page.locator(`[data-group-fold="${groupId}"]`).click();
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount);

		// `[` folds and `]` unfolds the selected group; on a member, they act on its container.
		await group.click({ position: { x: 8, y: 8 }, force: true });
		await page.keyboard.press('[');
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount - 3);
		await page.keyboard.press('[');
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount - 3);
		await page.keyboard.press(']');
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount);
		await first.click();
		await expect(page.getByRole('group', { name: 'Actions du nœud' })).toBeVisible();
		await expect(
			page.getByRole('group', { name: 'Actions du nœud' }).getByRole('button', { name: /Replier/ }),
		).toHaveCount(0);
		await page.keyboard.press('[');
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount - 3);
		await expect(group).toHaveCount(1);
		await group.click({ position: { x: 8, y: 8 }, force: true });
		await page.keyboard.press(']');
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount);

		// Dissolving keeps the members in their container and removes only the group.
		await group.click({ position: { x: 8, y: 8 }, force: true });
		await page
			.getByRole('group', { name: 'Actions du groupe' })
			.getByRole('button', { name: `Dissoudre le groupe ${groupId}` })
			.click();
		await expect(page.locator('[data-group-id]')).toHaveCount(previousGroups);
		await expect(page.locator('[data-node-id]')).toHaveCount(nodeCount);
		await expect(first).toHaveAttribute('data-node-group-id', 'use-cases');
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

	test('opens the keyboard shortcuts panel from its button or ?, never from a text field', async ({
		page,
	}) => {
		const help = page.getByRole('button', { name: 'Raccourcis clavier', exact: true });
		const panel = page.getByRole('dialog', { name: 'Raccourcis clavier' });
		await help.click();
		await expect(panel).toBeVisible();
		await expect(panel).toContainText('Propriétés…');
		await expect(panel).toContainText('Supprimer');
		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
		await expect(help).toBeFocused();

		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.focus();
		await page.keyboard.press('?');
		await expect(panel).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
		await expect(node).toBeFocused();

		await node.dblclick();
		const content = page
			.locator('[data-node-draft="traceable-edits"]')
			.getByRole('textbox', { name: 'Contenu de la boîte' });
		await expect(content).toBeFocused();
		await page.keyboard.press('?');
		await expect(content).toHaveText(/\?/);
		await expect(panel).toHaveCount(0);
	});
});

test.describe('box dialog editing and creation', () => {
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
			name: 'Propriétés du nœud traceable-edits',
		});
		await expect(edit).toBeVisible();
		const nodeBounds = await node.boundingBox();
		if (!nodeBounds) throw new Error('Selected node has no bounds');

		await edit.click();
		const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
		await expect(dialog).toBeVisible();
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		const textarea = page.getByRole('textbox', { name: 'Contenu' });
		await expect(textarea).toBeFocused();
		await expect(textarea).toHaveText('ALCOA+: All edits needs to be tracable');

		await textarea.fill('A much longer local draft that must not remeasure the graph.\n'.repeat(8));
		await expect(measured).toContainText('ALCOA+: All edits needs to be tracable');
		await expect(measured).not.toContainText('A much longer local draft');
		expect(await node.boundingBox()).toEqual(nodeBounds);
		await page.keyboard.press('Tab');
		await expect(
			dialog.locator('[data-text-field="description"] .ql-toolbar').getByRole('button').first(),
		).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByRole('textbox', { name: 'Description' })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.locator(':focus')).toHaveCount(1);
		const cancel = page.getByRole('button', { name: 'Annuler' });
		const save = page.getByRole('button', { name: 'Enregistrer' });
		await cancel.focus();
		await page.keyboard.press('Tab');
		await expect(save).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(dialog.getByLabel('Nature')).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(save).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(cancel).toBeFocused();
		await cancel.click();

		await expect(dialog).toHaveCount(0);
		await expect(node).toBeFocused();
		await expect(node).toContainText('ALCOA+: All edits needs to be tracable');
		await expect(edit).toBeVisible();
	});

	test('saves through reprojection and keeps the Floating UI bar stable during rapid scroll and zoom', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await openBoxDialog(page, node);
		const textarea = page.getByRole('textbox', { name: 'Contenu' });
		await expect(textarea).toBeFocused();
		const replacement = [
			'Saved through the typed document command.',
			'This longer value changes intrinsic layout.',
			'The accepted overlay must follow the node.',
		].join('\n');
		await textarea.fill(replacement);
		await page.getByRole('button', { name: 'Enregistrer' }).click();

		await expect(page.locator('[data-node-editor="traceable-edits"]')).toHaveCount(0);
		await expect(node).toContainText('Saved through the typed document command.');
		await expect(node).toBeFocused();
		const edit = page.getByRole('button', {
			name: 'Propriétés du nœud traceable-edits',
		});
		await expect(edit).toBeVisible();
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		await viewport.evaluate((element) => {
			for (let index = 0; index < 30; index += 1) {
				element.scrollTo(index * 17, index * 23);
			}
		});
		for (let index = 0; index < 4; index += 1) {
			await page.getByRole('button', { name: 'Zoom avant' }).click();
		}
		await expect(page.getByRole('button', { name: 'Réinitialiser le zoom' })).toHaveText('140%');
		await node.scrollIntoViewIfNeeded();
		await expect
			.poll(async () => {
				const nodeBounds = await node.boundingBox();
				const barBounds = await page.getByRole('group', { name: 'Actions du nœud' }).boundingBox();
				if (!nodeBounds || !barBounds) return Number.POSITIVE_INFINITY;
				const verticalGap = Math.min(
					Math.abs(nodeBounds.y - (barBounds.y + barBounds.height)),
					Math.abs(barBounds.y - (nodeBounds.y + nodeBounds.height)),
				);
				return verticalGap;
			})
			.toBeLessThanOrEqual(12);
	});

	test('types an existing box in place from Enter, and Escape keeps its saved text', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.focus();
		await page.keyboard.press('Enter');
		const content = page
			.locator('[data-node-draft="traceable-edits"]')
			.getByRole('textbox', { name: 'Contenu de la boîte' });
		await expect(content).toBeFocused();
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await content.fill('Draft cancelled from Escape');

		await page.keyboard.press('Escape');

		await expect(content).toHaveCount(0);
		await expect(node).toBeFocused();
		await expect(node).toContainText('ALCOA+: All edits needs to be tracable');
	});

	test('types an existing box in place from a double-click, measured as typed', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		const before = required((await node.boundingBox()) ?? undefined, 'Box has no bounds');
		await node.dblclick();
		const draft = page.locator('[data-node-draft="traceable-edits"]');
		const content = draft.getByRole('textbox', { name: 'Contenu de la boîte' });
		await expect(content).toBeFocused();
		await content.fill('Saved in place.\nOn a second line.\nAnd a third one, typed in the box.');
		await expect
			.poll(async () => (await draft.boundingBox())?.height ?? 0)
			.toBeGreaterThan(before.height);

		await page.keyboard.press('ControlOrMeta+Enter');

		await expect(draft).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(node).toContainText('And a third one, typed in the box.');
		await expect(node).toBeFocused();
	});

	test('from a box typed in place, Ctrl/Cmd+E saves it and opens its dialog', async ({ page }) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await node.dblclick();
		const content = page
			.locator('[data-node-draft="traceable-edits"]')
			.getByRole('textbox', { name: 'Contenu de la boîte' });
		await content.fill('Saved before the dialog');
		await page.keyboard.press('ControlOrMeta+e');
		const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('textbox', { name: 'Contenu' })).toHaveText(
			'Saved before the dialog',
		);
		await page.keyboard.press('Escape');
		await expect(node).toContainText('Saved before the dialog');
	});
	test('saves nature, description, and swatch color together', async ({ page }) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		await openBoxDialog(page, node);
		const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
		const nature = dialog.getByLabel('Nature');
		const currentNatureId = await nature.inputValue();
		const options = await nature
			.locator('option')
			.evaluateAll((elements: HTMLOptionElement[]) =>
				elements.map((element) => ({ id: element.value, label: element.textContent })),
			);
		const nextNature = required(
			options.find(({ id }) => id !== currentNatureId),
			'Expected another nature to select',
		);
		await nature.selectOption(nextNature.id);
		await dialog.getByRole('textbox', { name: 'Description' }).fill('Description enregistrée');
		await dialog.locator('details.style > summary').click();
		await dialog.getByRole('button', { name: 'Bleu moyen' }).click();
		await dialog.getByRole('button', { name: 'Enregistrer' }).click();

		await expect(node).toContainText(nextNature.label);
		expect(
			await node.evaluate((element) =>
				getComputedStyle(element).getPropertyValue('--content-color'),
			),
		).toBe('#3b82f6');
		await openBoxDialog(page, node);
		await expect(dialog.getByRole('textbox', { name: 'Description' })).toHaveText(
			'Description enregistrée',
		);
		await page.keyboard.press('Escape');
	});

	test('contains keyboard focus and remains usable at a narrow viewport', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 640 });
		const node = page.locator('[data-node-id="traceable-edits"]');
		await openBoxDialog(page, node);
		const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
		const textarea = page.getByRole('textbox', { name: 'Contenu' });
		await expect(dialog).toBeVisible();
		await expect(textarea).toBeFocused();
		const bounds = await dialog.boundingBox();
		if (!bounds) throw new Error('Narrow box dialog has no bounds');
		expect(bounds.x).toBeGreaterThanOrEqual(15);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(345);

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(node).toBeFocused();
	});

	test('types a child in place with C, then chains children with Ctrl/Cmd+Shift+Enter', async ({
		page,
	}) => {
		const parent = page.locator('[data-node-id="ai-content-generation"]');
		await parent.click();
		await page.keyboard.press('c');

		const first = await typedBox(page);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(first.content).toHaveText('');
		await first.content.fill('First keyboard child');
		await page.keyboard.press('ControlOrMeta+Shift+Enter');

		const second = await typedBox(page);
		expect(second.id).not.toBe(first.id);
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${first.id}"][data-edge-to="ai-content-generation"]`,
			),
		).toHaveCount(1);
		await second.content.fill('Grandchild');
		await page.keyboard.press('ControlOrMeta+Enter');

		const grandchild = page.locator(`[data-node-id="${second.id}"]`);
		await expect(grandchild).toBeFocused();
		await expect(grandchild).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('[data-node-draft]')).toHaveCount(0);
		await expect(
			page.locator(`[data-relation-id][data-edge-from="${second.id}"][data-edge-to="${first.id}"]`),
		).toHaveCount(1);
	});

	test('types a root box with N when nothing is selected', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		const focusedNode = page.locator('[data-node-id]').first();
		await focusedNode.focus();
		await expect(focusedNode).toHaveAttribute('aria-pressed', 'false');
		await page.keyboard.press('n');

		const { content, id } = await typedBox(page);
		await content.fill('Root keyboard box');
		await page.keyboard.press('ControlOrMeta+Enter');

		const root = page.locator(`[data-node-id="${id}"]`);
		await expect(root).toHaveAttribute('aria-pressed', 'true');
		await expect(root).toContainText('Root keyboard box');
		await expect(
			page.locator(
				`[data-relation-id][data-edge-from="${id}"], [data-relation-id][data-edge-to="${id}"]`,
			),
		).toHaveCount(0);
	});

	test('Escape, or confirming an empty box, creates nothing', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		const viewport = page.getByRole('region', { name: 'Canvas viewport' });
		await viewport.focus();
		await page.keyboard.press('n');
		const { content } = await typedBox(page);
		await content.fill('Cancelled creation');
		await page.keyboard.press('Escape');
		await expect(page.locator('[data-node-draft]')).toHaveCount(0);
		await expect(viewport).toBeFocused();

		await page.keyboard.press('n');
		await typedBox(page);
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(page.locator('[data-node-draft]')).toHaveCount(0);
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		await expect(page.getByText('Cancelled creation')).toHaveCount(0);
	});

	test('Escape on a child gives the selection and focus back to its parent', async ({ page }) => {
		const parent = page.locator('[data-node-id="ai-content-generation"]');
		await parent.click();
		await page.keyboard.press('c');
		await typedBox(page);
		await expect(parent).toHaveAttribute('aria-pressed', 'false');
		await page.keyboard.press('Escape');
		await expect(parent).toBeFocused();
		await expect(parent).toHaveAttribute('aria-pressed', 'true');
	});

	test('N and the sidebar action type a root box, even with a selection', async ({ page }) => {
		const triggers = [
			() => page.keyboard.press('n'),
			() => page.getByRole('button', { name: 'Nouvelle boîte', exact: true }).click(),
		];
		for (const [index, trigger] of triggers.entries()) {
			await page.locator('[data-node-id="ai-content-generation"]').click();
			await trigger();
			const { content, id } = await typedBox(page);
			await content.fill(`Root beside selection ${index}`);
			await page.keyboard.press('ControlOrMeta+Enter');
			await expect(page.locator(`[data-node-id="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
			await expect(
				page.locator(
					`[data-relation-id][data-edge-from="${id}"], [data-relation-id][data-edge-to="${id}"]`,
				),
			).toHaveCount(0);
		}
	});

	test('the bar of the selected box stays in place while it is typed, with the same actions', async ({
		page,
	}) => {
		const node = page.locator('[data-node-id="traceable-edits"]');
		const typed = page.locator('[data-node-draft="traceable-edits"]');
		/** How far above its box a bar ends: the same in both states, and as the box grows. */
		async function gapAbove(bar: Locator, box: Locator): Promise<number> {
			await settleCanvasMotion(page);
			const [barBounds, boxBounds] = await Promise.all([bar.boundingBox(), box.boundingBox()]);
			if (!barBounds || !boxBounds) throw new Error('Bar or box has no bounds');
			return boxBounds.y - (barBounds.y + barBounds.height);
		}
		await node.click();
		const nodeBar = page.getByRole('group', { name: 'Actions du nœud' });
		await expect(nodeBar).toBeVisible();
		const selectedGap = await gapAbove(nodeBar, node);
		await node.dblclick();
		const actions = page.getByRole('group', { name: 'Actions de la saisie' });
		await expect(nodeBar).toHaveCount(0);
		await expect(actions.getByRole('button')).toHaveText([
			/Valider/,
			/Créer un enfant/,
			/Propriétés…/,
			/Annuler/,
		]);
		expect(selectedGap).toBeGreaterThan(0);
		expect(await gapAbove(actions, typed)).toBeCloseTo(selectedGap, 0);
		const content = typed.getByRole('textbox', { name: 'Contenu de la boîte' });
		await expect(content).toBeFocused();
		const before = await typed.boundingBox();
		// The caret starts at the end of the text; the keyboard types as the author does.
		await page.keyboard.type(' et encore quelques mots pour une ligne de plus');
		await expect
			.poll(async () => (await typed.boundingBox())?.height)
			.toBeGreaterThan(before?.height ?? Infinity);
		expect(await gapAbove(actions, typed)).toBeCloseTo(selectedGap, 0);
		await page.keyboard.press('Escape');
		await expect(actions).toHaveCount(0);
	});

	test('the actions of the typed box confirm it or open its properties', async ({ page }) => {
		await page.getByRole('region', { name: 'Canvas viewport' }).focus();
		await page.keyboard.press('n');
		const typed = await typedBox(page);
		const actions = page.getByRole('group', { name: 'Actions de la saisie' });
		await expect(actions.getByRole('button', { name: /Propriétés…/ })).toHaveAttribute(
			'aria-keyshortcuts',
			'Control+e Meta+e',
		);
		await typed.content.fill('Boîte à détailler');
		await page.keyboard.press('ControlOrMeta+e');
		const dialog = page.getByRole('dialog', { name: 'Propriétés de la boîte' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('textbox', { name: 'Contenu' })).toHaveText('Boîte à détailler');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);

		await page.getByRole('region', { name: 'Canvas viewport' }).focus();
		await page.keyboard.press('n');
		const next = await typedBox(page);
		await next.content.fill('Validée à la souris');
		await actions.getByRole('button', { name: /Valider/ }).click();
		await expect(page.locator(`[data-node-id="${next.id}"]`)).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	test('clicking elsewhere creates the typed box and leaves it unselected', async ({ page }) => {
		await page.getByRole('region', { name: 'Canvas viewport' }).focus();
		await page.keyboard.press('n');
		const { content, id } = await typedBox(page);
		await content.fill('Laissée en cliquant ailleurs');
		const other = page.locator('[data-node-id="ai-content-generation"]');
		await other.click();
		const created = page.locator(`[data-node-id="${id}"]`);
		await expect(created).toContainText('Laissée en cliquant ailleurs');
		await expect(created).toHaveAttribute('aria-pressed', 'false');
		await expect(other).toHaveAttribute('aria-pressed', 'true');
	});

	test('new boxes take the nature chosen in the sidebar, children included', async ({ page }) => {
		const picker = page
			.getByRole('navigation', { name: 'Actions du canvas' })
			.getByRole('button', { name: /^Nouvelles boîtes :/ });
		await picker.click();
		const menu = page.getByRole('menu', { name: 'Nature des nouvelles boîtes' });
		const items = menu.getByRole('menuitemradio');
		const chosen = items.nth(1);
		const label = (await chosen.textContent())?.trim() ?? '';
		await expect(chosen).toHaveAttribute('aria-checked', 'false');
		await chosen.click();
		await expect(picker).toHaveAccessibleName(`Nouvelles boîtes : ${label}`);

		await page.locator('[data-node-id="ai-content-generation"]').click();
		await page.keyboard.press('c');
		const { draft, content, id } = await typedBox(page);
		await expect(draft).toContainText(label, { ignoreCase: true });
		await content.fill('Enfant de la nature choisie');
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(page.locator(`[data-node-id="${id}"]`)).toContainText(label, {
			ignoreCase: true,
		});
	});

	test('types a child of a junction from its contextual action', async ({ page }) => {
		const junction = page.locator('[data-junction-id="word-ui-options"]');
		await junction.click();
		const create = page
			.getByRole('group', { name: 'Actions de la jonction' })
			.getByRole('button', { name: 'Créer un enfant de word-ui-options', exact: true });
		await expect(create).toHaveAttribute('aria-keyshortcuts', 'c');
		await create.click();
		const { content, id } = await typedBox(page);
		await content.fill('Junction child');
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(
			page.locator(`[data-relation-id][data-edge-from="${id}"][data-edge-to="word-ui-options"]`),
		).toHaveCount(1);
	});
});

test('double-clicking a group title edits its title and color', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const group = page.locator('[data-group-id="use-cases"]');
	await expect(group).toContainText('Use cases');

	await group.locator('[data-group-header]').dblclick();

	const dialog = page.getByRole('dialog', { name: 'Propriétés du groupe' });
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

test('a child of a selected node inside a group stays within that group', async ({ page }) => {
	await page.goto('/examples/ai-documentary-effort');
	const group = page.locator('[data-group-id="use-cases"]');
	const target = page.locator('[data-node-id="traceable-edits"]');
	await expect(target).toHaveAttribute('data-node-group-id', 'use-cases');
	await target.click();
	await page.keyboard.press('c');
	const { content, id } = await typedBox(page);
	await content.fill('Group keyboard child');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(
		page.locator(`[data-relation-id][data-edge-from="${id}"][data-edge-to="traceable-edits"]`),
	).toHaveCount(1);
	const child = page.locator(`[data-node-id="${id}"]`);
	await expect(child).toHaveAttribute('aria-pressed', 'true');
	await expect(child).toHaveAttribute('data-node-group-id', 'use-cases');
	await settleCanvasMotion(page);
	const childBox = await child.boundingBox();
	const groupBox = await group.boundingBox();
	if (!childBox || !groupBox) throw new Error('Created group child has no rendered geometry');
	expect(
		childBox.x >= groupBox.x &&
			childBox.y >= groupBox.y &&
			childBox.x + childBox.width <= groupBox.x + groupBox.width &&
			childBox.y + childBox.height <= groupBox.y + groupBox.height,
	).toBe(true);
});

test('double-click types a box in place; Backspace and the delete action remove nodes', async ({
	page,
}) => {
	await page.goto('/');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	const point = await blankCanvasPoint(page);
	await page.mouse.dblclick(point.x, point.y);
	const { content } = await typedBox(page);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await content.fill('Nouvelle idée canvas');
	await content.press('Backspace');
	await expect(page.locator('[data-node-id]')).toHaveCount(24);
	await content.fill('Nouvelle idée canvas');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(page.locator('[data-node-draft]')).toHaveCount(0);
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

for (const { kind, selector, membership } of [
	{ kind: 'node', selector: '[data-node-id="traceable-edits"]', membership: 'data-node-group-id' },
	{
		kind: 'junction',
		selector: '[data-junction-id="word-ui-options"]',
		membership: 'data-junction-group-id',
	},
]) {
	test(`dropping a member ${kind} on its enclosing group background is a no-op`, async ({
		page,
	}) => {
		await page.goto('/');
		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		const relations = await page.locator('[data-relation-id]').count();
		const member = page.locator(selector);
		const group = page.locator('[data-group-id="use-cases"]');
		await expect(member).toHaveAttribute(membership, 'use-cases');
		await member.scrollIntoViewIfNeeded();
		const origin = await member.boundingBox();
		const header = await group.locator('[data-group-header]').boundingBox();
		if (!origin || !header) throw new Error('Missing geometry');
		const drop = { x: origin.x + origin.width / 2, y: header.y + header.height / 2 };
		expect(
			await page.evaluate(
				({ x, y }) =>
					document
						.elementsFromPoint(x, y)
						.some((element) => element.closest('[data-group-id="use-cases"]') !== null),
				drop,
			),
		).toBe(true);
		await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
		await page.mouse.down();
		await page.mouse.move(drop.x, drop.y, { steps: 8 });
		await expect(group).not.toHaveAttribute('data-connection-target');
		await page.mouse.up();
		await expect(page.locator('[data-relation-id]')).toHaveCount(relations);
		await expect(page.getByText('Échec du calcul de mise en page')).toHaveCount(0);
	});
}

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

test('undoes and redoes accepted edits step by step, leaving a text field its own history', async ({
	page,
}) => {
	await page.goto('/');
	const node = page.locator('[data-node-id="traceable-edits"]');
	await expect(node).toContainText('ALCOA+');
	const nodes = await page.locator('[data-node-id]').count();
	const relations = await page.locator('[data-relation-id]').count();

	// Nothing to undo yet: the chord is inert.
	await page.getByRole('region', { name: 'Canvas viewport' }).focus();
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes);

	// One text save is one step; inside the field, the chord stays native.
	await openBoxDialog(page, node);
	const textarea = page.getByRole('textbox', { name: 'Contenu' });
	await textarea.fill('Première version');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.getByRole('dialog', { name: 'Propriétés de la boîte' })).toBeVisible();
	await textarea.fill('Seconde version');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(node).toContainText('Seconde version');

	// A deletion with its incident relations is one step too.
	await node.click();
	await page.keyboard.press('Delete');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes - 1);
	await expect(page.locator('[data-relation-id]')).toHaveCount(relations - 1);

	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes);
	await expect(page.locator('[data-relation-id]')).toHaveCount(relations);
	await expect(node).toContainText('Seconde version');

	await page.keyboard.press('ControlOrMeta+z');
	await expect(node).toContainText('ALCOA+');

	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(node).toContainText('Seconde version');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes - 1);

	// A new edit drops the redo branch.
	await page.keyboard.press('ControlOrMeta+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes);
	await page.locator('[data-node-id="training-roi"]').click();
	await page.keyboard.press('Delete');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes - 1);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(page.locator('[data-node-id]')).toHaveCount(nodes - 1);
	await expect(node).toHaveCount(1);
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
	const member = await typedBox(page);
	await member.content.fill('Membre créé dans le groupe');
	await page.keyboard.press('ControlOrMeta+Enter');
	const created = page.locator(`[data-node-id="${member.id}"]`);
	await expect(created).toHaveAttribute('data-node-group-id', 'data-team');
	await settleCanvasMotion(page);
	const background = await blankCanvasPoint(page);
	await page.mouse.dblclick(background.x, background.y);
	const root = await typedBox(page);
	await root.content.fill('Boîte hors groupe');
	await page.keyboard.press('ControlOrMeta+Enter');
	const outside = page.locator(`[data-node-id="${root.id}"]`);
	await expect(outside).toBeVisible();
	await expect(outside).not.toHaveAttribute('data-node-group-id');
	await group.focus();
	await group.press('Enter');
	await group.press('Delete');
	await expect(group).toHaveCount(0);
	await expect(created).toHaveCount(0);
	await expect(outside).toBeVisible();
});
