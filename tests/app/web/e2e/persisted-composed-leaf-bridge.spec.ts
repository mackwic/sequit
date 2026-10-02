import { expect, type Page, test } from '@playwright/test';

import {
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { persistedComposedLeafBridgeDocument } from '../../../lib/core/layout/nested-region-fixture';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

async function renderedComposition(page: Page) {
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(2);
	await expect(page.locator('[data-node-id]')).toHaveCount(5);
	for (const id of ['lane-local', 'ordinary-local', 'cross'])
		await expect(page.locator(`[data-relation-id="${id}"]`)).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	return page.evaluate(() => {
		const frame = (id: string) => {
			const region = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
			if (region === null) throw new Error(`Missing region ${id}`);
			return region.getBoundingClientRect();
		};
		const lane = frame('lane');
		const ordinary = frame('ordinary');
		const inside = (point: DOMPoint, bounds: DOMRect) =>
			point.x > bounds.left + 1 &&
			point.x < bounds.right - 1 &&
			point.y > bounds.top + 1 &&
			point.y < bounds.bottom - 1;
		const path = (id: string) => {
			const route = document.querySelector<SVGPathElement>(`[data-relation-id="${id}"]`);
			if (route === null) throw new Error(`Missing rendered route ${id}`);
			const matrix = route.getScreenCTM();
			if (matrix === null) throw new Error(`Missing transform for ${id}`);
			const length = route.getTotalLength();
			return {
				d: route.getAttribute('d'),
				points: Array.from({ length: 257 }, (_, sample) => {
					const point = route.getPointAtLength((length * sample) / 256);
					return new DOMPoint(point.x, point.y).matrixTransform(matrix);
				}),
			};
		};
		const cross = path('cross');
		const localLane = path('lane-local');
		const localOrdinary = path('ordinary-local');
		let portalExit = 0;
		let portalEntrance = 0;
		for (let index = 1; index < cross.points.length; index += 1) {
			const previous = cross.points[index - 1];
			const current = cross.points[index];
			if (previous === undefined || current === undefined)
				throw new Error('Missing crossing sample');
			if (inside(previous, lane) && !inside(current, lane)) portalExit += 1;
			if (!inside(previous, ordinary) && inside(current, ordinary)) portalEntrance += 1;
		}
		const start = cross.points[0];
		const end = cross.points.at(-1);
		if (start === undefined || end === undefined) throw new Error('Missing crossing endpoints');
		return {
			paths: { cross: cross.d, laneLocal: localLane.d, ordinaryLocal: localOrdinary.d },
			portalExit,
			portalEntrance,
			startsInLane: inside(start, lane),
			endsInOrdinary: inside(end, ordinary),
			laneStaysOpaque: localLane.points.every((point) => !inside(point, ordinary)),
			ordinaryStaysOpaque: localOrdinary.points.every((point) => !inside(point, lane)),
		};
	});
}

function bridgeOnlyDocument(): LogicDocument {
	const source = persistedComposedLeafBridgeDocument();
	const laneIds = ['A', 'A', 'B', 'C'] as const;
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'bridge-only-lanes',
		title: 'Pont indispensable entre trois dépendances',
		layout: source.layout,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: ['A', 'B', 'C'].map((id, index) => ({
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
		},
		natures: source.natures,
		groups: [],
		junctions: [],
		nodes: source.nodes.slice(0, 4).map((node, index) => {
			const laneId = laneIds[index];
			if (laneId === undefined) throw new Error('Missing lane for persisted node');
			return {
				kind: node.kind,
				id: node.id,
				natureId: node.natureId,
				markdown: node.markdown,
				layoutOrder: node.layoutOrder,
				laneId,
			};
		}),
		// a → c leaves lane A toward B while d → b comes back from C across B: the crossing needs a bridge.
		relations: [
			{ id: 'within-a', from: 'a', to: 'b' },
			{ id: 'a-to-c', from: 'a', to: 'c' },
			{ id: 'd-to-b', from: 'd', to: 'b' },
		],
	};
}

test('the persisted composed leaf uses its bridge-free portal route and reloads identically', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedComposedLeafBridgeDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	const before = await renderedComposition(page);
	expect(before.paths.cross).toMatch(/^M /);
	for (const route of Object.values(before.paths)) expect(route).not.toMatch(/\bA 6 6 /);
	expect(before).toMatchObject({
		portalExit: 1,
		portalEntrance: 1,
		startsInLane: true,
		endsInOrdinary: true,
		laneStaysOpaque: true,
		ordinaryStaysOpaque: true,
	});
	const screenshot = info.outputPath('persisted-composed-leaf-detour.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-composed-leaf-detour', {
		path: screenshot,
		contentType: 'image/png',
	});
	await page.reload();
	expect(await renderedComposition(page)).toEqual(before);
});

test('a persisted three-dependency lane crossing renders its necessary bridge', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, bridgeOnlyDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	const paths = await page
		.locator('[data-relation-id]')
		.evaluateAll((routes) => routes.map((route) => route.getAttribute('d') ?? ''));
	expect(paths.some((path) => /\bA 6 6 /.test(path))).toBe(true);
	const screenshot = info.outputPath('persisted-lane-necessary-bridge.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-lane-necessary-bridge', {
		path: screenshot,
		contentType: 'image/png',
	});
});
