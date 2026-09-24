import { expect, test } from '@playwright/test';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	persistedGridDocument,
	persistedNxmGridDocument,
} from '../../../lib/core/layout/grid-cell-fixture';
import { persistedNestedGridWithGroupPortalDocument } from '../../../lib/core/layout/nested-region-fixture';
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

test('persisted crossing routes share node endpoints through distinct exterior tracks', async ({
	page,
}) => {
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
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	for (const id of ['across-grid', 'second-crossing', 'third-crossing'])
		await expect(page.locator(`[data-relation-id="${id}"]`)).toHaveCount(1);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	await page.evaluate(() => {
		const route = (id: string): SVGPathElement => {
			const element = document.querySelector<SVGPathElement>(`[data-relation-id="${id}"]`);
			if (element === null) throw new Error(`Missing route ${id}`);
			return element;
		};
		const first = route('across-grid');
		const second = route('second-crossing');
		if (first.getPointAtLength(0).y === second.getPointAtLength(0).y)
			throw new Error('Shared source node was assigned the same port twice');
		for (const [id, foreign] of [
			['across-grid', ['b', 'c']],
			['second-crossing', ['b', 'd']],
			['third-crossing', ['b', 'c']],
		] as const) {
			const path = route(id);
			const matrix = path.getScreenCTM();
			if (matrix === null) throw new Error(`Missing route transform ${id}`);
			const length = path.getTotalLength();
			for (let sample = 0; sample <= 128; sample += 1) {
				const point = path.getPointAtLength((length * sample) / 128);
				const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				for (const cellId of foreign) {
					const cell = document.querySelector<HTMLElement>(`[data-region-id="${cellId}"]`);
					if (cell === null) throw new Error(`Missing cell ${cellId}`);
					const bounds = cell.getBoundingClientRect();
					if (
						screen.x > bounds.left + 1 &&
						screen.x < bounds.right - 1 &&
						screen.y > bounds.top + 1 &&
						screen.y < bounds.bottom - 1
					)
						throw new Error(`${id} entered opaque cell ${cellId}`);
				}
			}
		}
	});
});

test('a direct cross-cell group relation attaches to the group face and keeps cells opaque', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedGridDocument();
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		relations: [...source.relations, { id: 'group-crossing', from: 'oversized', to: 'd' }],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id="group-crossing"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	await page.evaluate(() => {
		const group = document.querySelector<HTMLElement>('[data-group-id="oversized"]');
		const member = document.querySelector<HTMLElement>('[data-node-id="b"]');
		const path = document.querySelector<SVGPathElement>('[data-relation-id="group-crossing"]');
		if (group === null || member === null || path === null)
			throw new Error('Missing group portal witness');
		const groupBounds = group.getBoundingClientRect();
		const memberBounds = member.getBoundingClientRect();
		if (
			memberBounds.left <= groupBounds.left ||
			memberBounds.right >= groupBounds.right ||
			memberBounds.top <= groupBounds.top ||
			memberBounds.bottom >= groupBounds.bottom
		)
			throw new Error('The member leaves the indivisible group');
		const matrix = path.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const start = path.getPointAtLength(0);
		const screen = new DOMPoint(start.x, start.y).matrixTransform(matrix);
		if (
			Math.abs(screen.x - groupBounds.right) > 2 ||
			screen.y <= groupBounds.top ||
			screen.y >= groupBounds.bottom
		)
			throw new Error('The route does not attach to the outside group face');
		const length = path.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = path.getPointAtLength((length * sample) / 128);
			const position = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			for (const id of ['a', 'c']) {
				const cell = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
				if (cell === null) throw new Error(`Missing cell ${id}`);
				const bounds = cell.getBoundingClientRect();
				if (
					position.x > bounds.left + 1 &&
					position.x < bounds.right - 1 &&
					position.y > bounds.top + 1 &&
					position.y < bounds.bottom - 1
				)
					throw new Error(`Group route entered opaque cell ${id}`);
			}
		}
	});
	const screenshot = info.outputPath('cross-cell-group-portal.png');
	await page.screenshot({ path: screenshot });
	await info.attach('cross-cell-group-portal', { path: screenshot, contentType: 'image/png' });
});

test('a persisted three by two grid renders six cells in three column and two row tracks', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedNxmGridDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	for (const id of ['a-b', 'a-c', 'c-f'])
		await expect(page.locator(`[data-relation-id="${id}"]`)).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	const frames = await page.evaluate(() => {
		const rectangles = new Map<string, DOMRect>();
		for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
			const element = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
			if (element === null) throw new Error(`Missing grid cell ${id}`);
			rectangles.set(id, element.getBoundingClientRect());
		}
		const box = (id: string): DOMRect => {
			const bounds = rectangles.get(id);
			if (bounds === undefined) throw new Error(`Missing bounds for ${id}`);
			return bounds;
		};
		for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
			const cell = box(id);
			const endpoint = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
			if (endpoint === null) throw new Error(`Missing endpoint ${id}`);
			const bounds = endpoint.getBoundingClientRect();
			if (
				bounds.left <= cell.left ||
				bounds.right >= cell.right ||
				bounds.top <= cell.top ||
				bounds.bottom >= cell.bottom
			)
				throw new Error(`${id} escaped cell ${id}`);
		}
		for (const [id, foreign] of [
			['a-b', ['c', 'd', 'e', 'f']],
			['a-c', ['b', 'd', 'e', 'f']],
			['c-f', ['a', 'b', 'd', 'e']],
		] as const) {
			const path = document.querySelector<SVGPathElement>(`[data-relation-id="${id}"]`);
			if (path === null) throw new Error(`Missing route ${id}`);
			const matrix = path.getScreenCTM();
			if (matrix === null) throw new Error(`Missing route transform ${id}`);
			const length = path.getTotalLength();
			for (let sample = 0; sample <= 128; sample += 1) {
				const point = path.getPointAtLength((length * sample) / 128);
				const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				for (const cellId of foreign) {
					const bounds = box(cellId);
					if (
						screen.x > bounds.left + 1 &&
						screen.x < bounds.right - 1 &&
						screen.y > bounds.top + 1 &&
						screen.y < bounds.bottom - 1
					)
						throw new Error(`${id} entered opaque cell ${cellId}`);
				}
			}
		}
		return [...rectangles].map(([id, bounds]) => ({ id, x: bounds.x, y: bounds.y }));
	});
	const at = (id: string) => {
		const frame = frames.find((entry) => entry.id === id);
		if (frame === undefined) throw new Error(`Missing frame ${id}`);
		return frame;
	};
	const close = (left: number, right: number): boolean => Math.abs(left - right) < 1;
	expect(close(at('a').y, at('b').y)).toBe(true);
	expect(close(at('b').y, at('c').y)).toBe(true);
	expect(close(at('a').x, at('d').x)).toBe(true);
	expect(close(at('b').x, at('e').x)).toBe(true);
	expect(close(at('c').x, at('f').x)).toBe(true);
	expect(at('a').x).toBeLessThan(at('b').x);
	expect(at('b').x).toBeLessThan(at('c').x);
	expect(at('a').y).toBeLessThan(at('d').y);
	const screenshot = info.outputPath('persisted-three-by-two-grid.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-three-by-two-grid', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('a persisted nested group crosses an internal grid to a foreign cell from its own face', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedNestedGridWithGroupPortalDocument();
	const group = defined(source.groups[0]);
	const inner = { ...group, groupId: 'outer-group' };
	delete inner.regionId;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		groups: [{ ...group, id: 'outer-group', layoutOrder: orderKey('a1') }, inner],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-group-id="outer-group"]')).toHaveCount(1);
	await expect(page.locator('[data-group-id="cell-group"]')).toHaveCount(1);
	await expect(page.locator('[data-node-id="b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="group-crossing"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	await page.evaluate(() => {
		const outer = document.querySelector<HTMLElement>('[data-group-id="outer-group"]');
		const inner = document.querySelector<HTMLElement>('[data-group-id="cell-group"]');
		const member = document.querySelector<HTMLElement>('[data-node-id="b"]');
		const route = document.querySelector<SVGPathElement>('[data-relation-id="group-crossing"]');
		if (outer === null || inner === null || member === null || route === null)
			throw new Error('Missing persisted nested group witness');
		const outerBounds = outer.getBoundingClientRect();
		const innerBounds = inner.getBoundingClientRect();
		const memberBounds = member.getBoundingClientRect();
		if (
			innerBounds.left <= outerBounds.left ||
			innerBounds.right >= outerBounds.right ||
			innerBounds.top <= outerBounds.top ||
			innerBounds.bottom >= outerBounds.bottom
		)
			throw new Error('The nested group leaves its outer group');
		if (
			memberBounds.left <= innerBounds.left ||
			memberBounds.right >= innerBounds.right ||
			memberBounds.top <= innerBounds.top ||
			memberBounds.bottom >= innerBounds.bottom
		)
			throw new Error('The member leaves its nested group');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const start = route.getPointAtLength(0);
		const contact = new DOMPoint(start.x, start.y).matrixTransform(matrix);
		if (
			Math.abs(contact.x - innerBounds.right) > 2 ||
			contact.y <= innerBounds.top ||
			contact.y >= innerBounds.bottom
		)
			throw new Error('The route does not attach to the nested group own face');
	});
	const screenshot = info.outputPath('persisted-internal-nested-group.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-internal-nested-group', {
		path: screenshot,
		contentType: 'image/png',
	});
});
