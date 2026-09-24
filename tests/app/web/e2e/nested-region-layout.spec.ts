import { expect, test } from '@playwright/test';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LaneGrowth,
	LaneOrientation,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_PRESENTATION_SCHEMA,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	depthTwoRegionDocument,
	persistedDepthTwoRegionDocument,
	persistedNestedGridDocument,
	persistedNestedGridWithGroupPortalDocument,
	persistedNestedGridWithInnerLaneCrossingDocument,
	persistedNestedGridWithLaneCellDocument,
	persistedNestedGridWithLaneCrossingDocument,
	persistedNestedGridWithTwoOuterIncidentsDocument,
} from '../../../lib/core/layout/nested-region-fixture';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

function nestedRegionsDocument(
	room: string,
	layout: LayoutConfiguration = { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
): LogicDocument {
	const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, room);
	const template = defined(source.nodes[0]);
	return {
		...source,
		persistenceFormat: REGION_PERSISTENCE_FORMAT,
		layout,
		regionPresentation: {
			schemaVersion: REGION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'left',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'middle',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'right',
					layoutOrder: orderKey('a2'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: [
			{
				...template,
				id: 'a-source',
				markdown: 'A source',
				regionId: 'left',
				layoutOrder: orderKey('a0'),
			},
			{
				...template,
				id: 'a-target',
				markdown: 'A target',
				regionId: 'left',
				layoutOrder: orderKey('a1'),
			},
			{
				...template,
				id: 'b',
				markdown: 'B opaque',
				regionId: 'middle',
				layoutOrder: orderKey('a2'),
			},
			{
				...template,
				id: 'c',
				markdown: 'C',
				regionId: 'right',
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'a-local', from: 'a-source', to: 'a-target' },
			{ id: 'a-c', from: 'a-target', to: 'c' },
		],
	};
}

function regionLaneDocument(room: string, orientation: LaneOrientation): LogicDocument {
	const source = nestedRegionsDocument(room, {
		direction: LayoutDirection.TopToBottom,
		bias: LayoutBias.Top,
	});
	const presentation = defined(source.regionPresentation);
	return {
		...source,
		persistenceFormat: REGION_LANE_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_LANE_PRESENTATION_SCHEMA,
			regions: presentation.regions.map((region) => {
				if (region.id !== 'left') return region;
				return {
					...region,
					lanePresentation: {
						laneOrientation: orientation,
						growth: LaneGrowth.Auto,
						lanes: [
							{ id: 'sales', label: 'Sales', layoutOrder: orderKey('a0') },
							{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
						],
					},
				};
			}),
		},
		nodes: source.nodes.map((node) => {
			if (node.id === 'a-source') return { ...node, laneId: 'sales' };
			if (node.id === 'a-target') return { ...node, laneId: 'service' };
			return node;
		}),
	};
}

test('a persisted region contains its group and member while a foreign route passes by', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = nestedRegionsDocument(room);
	const document: LogicDocument = {
		...source,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'middle-group',
				label: 'Middle group',
				layoutOrder: orderKey('a2'),
				regionId: 'middle',
			},
		],
		nodes: source.nodes.map((node) => {
			if (node.id === 'b') {
				const member = { ...node, groupId: 'middle-group' };
				delete member.regionId;
				return member;
			}
			return node;
		}),
	};
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, document);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(3);
	await expect(page.locator('[data-group-id="middle-group"]')).toHaveCount(1);
	await expect(page.locator('[data-node-id="b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="a-c"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const middle = await page.locator('[data-region-id="middle"]').boundingBox();
	const group = await page.locator('[data-group-id="middle-group"]').boundingBox();
	const member = await page.locator('[data-node-id="b"]').boundingBox();
	if (middle === null || group === null || member === null)
		throw new Error('Missing persisted group geometry');
	expect(group.x).toBeGreaterThan(middle.x);
	expect(group.y).toBeGreaterThan(middle.y);
	expect(group.x + group.width).toBeLessThan(middle.x + middle.width);
	expect(group.y + group.height).toBeLessThan(middle.y + middle.height);
	expect(member.x).toBeGreaterThan(group.x);
	expect(member.y).toBeGreaterThan(group.y);
	expect(member.x + member.width).toBeLessThan(group.x + group.width);
	expect(member.y + member.height).toBeLessThan(group.y + group.height);
	const screenshot = info.outputPath('persisted-region-group.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-region-group', { path: screenshot, contentType: 'image/png' });
});

test('a persisted region contains a locally routed junction', async ({ page }, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = nestedRegionsDocument(room);
	const document: LogicDocument = {
		...source,
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'middle-junction',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a4'),
				regionId: 'middle',
			},
		],
		relations: [...source.relations, { id: 'middle-local', from: 'b', to: 'middle-junction' }],
	};
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, document);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-junction-id="middle-junction"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="middle-local"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="a-c"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const middle = await page.locator('[data-region-id="middle"]').boundingBox();
	const junction = await page.locator('[data-junction-id="middle-junction"]').boundingBox();
	if (middle === null || junction === null) throw new Error('Missing persisted junction geometry');
	expect(junction.x).toBeGreaterThan(middle.x);
	expect(junction.y).toBeGreaterThan(middle.y);
	expect(junction.x + junction.width).toBeLessThan(middle.x + middle.width);
	expect(junction.y + junction.height).toBeLessThan(middle.y + middle.height);
	const screenshot = info.outputPath('persisted-region-junction.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-region-junction', { path: screenshot, contentType: 'image/png' });
});

test('a persisted grid inside a region renders four cells beside an ordinary sibling', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedNestedGridDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	await expect(page.locator('[data-relation-id]')).toHaveCount(2);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const bounds = new Map<string, { x: number; y: number; width: number; height: number }>();
	for (const id of ['grid', 'a', 'b', 'c', 'd', 'outside']) {
		const box = await page.locator(`[data-region-id="${id}"]`).boundingBox();
		if (box === null) throw new Error(`Missing region ${id}`);
		bounds.set(id, box);
	}
	const grid = defined(bounds.get('grid'));
	for (const id of ['a', 'b', 'c', 'd']) {
		const cell = defined(bounds.get(id));
		expect(cell.x).toBeGreaterThan(grid.x);
		expect(cell.y).toBeGreaterThan(grid.y);
		expect(cell.x + cell.width).toBeLessThan(grid.x + grid.width);
		expect(cell.y + cell.height).toBeLessThan(grid.y + grid.height);
	}
	expect(defined(bounds.get('a')).x).toBeLessThan(defined(bounds.get('b')).x);
	expect(defined(bounds.get('a')).y).toBeLessThan(defined(bounds.get('c')).y);
	const screenshot = info.outputPath('persisted-nested-grid.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-nested-grid', { path: screenshot, contentType: 'image/png' });
});

test('a persisted route leaves an internal grid through both region boundaries', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedNestedGridDocument();
	const document = {
		...source,
		relations: [...source.relations, { id: 'leaves-grid', from: 'a-target', to: 'outside' }],
	};
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, document);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-relation-id="leaves-grid"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const screenshot = info.outputPath('persisted-grid-external-incident.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-external-incident', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('two persisted routes leave separate grid columns through their own portals', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(
		room,
		CollaborativeFixture.LinkedBoxes,
		persistedNestedGridWithTwoOuterIncidentsDocument(),
	);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(7);
	await expect(page.locator('[data-node-id]')).toHaveCount(7);
	await expect(page.locator('[data-relation-id="z-left-exit"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="a-right-exit"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const grid = await page.locator('[data-region-id="grid"]').boundingBox();
	const left = await page.locator('[data-region-id="a"]').boundingBox();
	const right = await page.locator('[data-region-id="b"]').boundingBox();
	if (grid === null || left === null || right === null)
		throw new Error('Missing two-incident grid frames');
	expect(left.x + left.width).toBeLessThan(right.x);
	expect(left.x).toBeGreaterThan(grid.x);
	expect(right.x + right.width).toBeLessThan(grid.x + grid.width);
	const screenshot = info.outputPath('persisted-grid-two-outer-incidents.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-two-outer-incidents', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('a grid cell renders its local lanes beside an intercell route elsewhere', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedNestedGridWithLaneCellDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-lane-region-id="b"]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id="inside-b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="across-grid"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const cell = await page.locator('[data-region-id="b"]').boundingBox();
	if (cell === null) throw new Error('Missing lane cell');
	for (const [laneId, nodeId] of [
		['left', 'b'],
		['right', 'b2'],
	] as const) {
		const lane = await page.locator(`[data-lane-id="${laneId}"]`).boundingBox();
		const node = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
		if (lane === null || node === null) throw new Error(`Missing ${laneId} lane or ${nodeId}`);
		expect(lane.x).toBeGreaterThanOrEqual(cell.x);
		expect(lane.y).toBeGreaterThanOrEqual(cell.y);
		expect(lane.x + lane.width).toBeLessThanOrEqual(cell.x + cell.width);
		expect(lane.y + lane.height).toBeLessThanOrEqual(cell.y + cell.height);
		expect(node.x).toBeGreaterThan(lane.x);
		expect(node.y).toBeGreaterThan(lane.y);
		expect(node.x + node.width).toBeLessThan(lane.x + lane.width);
		expect(node.y + node.height).toBeLessThan(lane.y + lane.height);
	}
	const screenshot = info.outputPath('persisted-grid-lane-cell.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-lane-cell', { path: screenshot, contentType: 'image/png' });
});

test('a lane cell renders its own intercell exit beside the local relation', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(
		room,
		CollaborativeFixture.LinkedBoxes,
		persistedNestedGridWithLaneCrossingDocument(),
	);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-lane-region-id="b"]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id="inside-b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="leaves-b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="across-grid"]')).toHaveCount(0);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const cell = await page.locator('[data-region-id="b"]').boundingBox();
	const rightLane = await page.locator('[data-lane-id="right"]').boundingBox();
	const source = await page.locator('[data-node-id="b2"]').boundingBox();
	if (cell === null || rightLane === null || source === null)
		throw new Error('Missing the source lane, cell or node');
	expect(rightLane.x).toBeGreaterThan(cell.x);
	expect(rightLane.x + rightLane.width).toBeLessThan(cell.x + cell.width);
	expect(source.x).toBeGreaterThan(rightLane.x);
	expect(source.x + source.width).toBeLessThan(rightLane.x + rightLane.width);
	const screenshot = info.outputPath('persisted-grid-lane-crossing.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-lane-crossing', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('an inner lane uses a separate passage beside its local route', async ({ page }, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(
		room,
		CollaborativeFixture.LinkedBoxes,
		persistedNestedGridWithInnerLaneCrossingDocument(),
	);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-lane-region-id="b"]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id="inside-b"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="leaves-b"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const innerLane = await page.locator('[data-lane-id="left"]').boundingBox();
	const source = await page.locator('[data-node-id="b"]').boundingBox();
	if (innerLane === null || source === null) throw new Error('Missing inner lane source');
	expect(source.x).toBeGreaterThan(innerLane.x);
	expect(source.x + source.width).toBeLessThan(innerLane.x + innerLane.width);
	const starts = await page
		.locator('[data-relation-id="inside-b"], [data-relation-id="leaves-b"]')
		.evaluateAll((routes) =>
			routes.map((route) => {
				if (!(route instanceof SVGPathElement)) throw new Error('Expected an SVG lane route');
				const matrix = route.getScreenCTM();
				if (matrix === null) throw new Error('Missing lane route transform');
				const start = route.getPointAtLength(0);
				return {
					id: route.getAttribute('data-relation-id'),
					point: new DOMPoint(start.x, start.y).matrixTransform(matrix),
				};
			}),
		);
	const local = starts.find(({ id }) => id === 'inside-b')?.point;
	const exit = starts.find(({ id }) => id === 'leaves-b')?.point;
	if (local === undefined || exit === undefined) throw new Error('Missing lane route starts');
	expect(local.y).toBeLessThan(exit.y);
	expect(Math.abs(exit.x - (source.x + source.width))).toBeLessThanOrEqual(2);
	const screenshot = info.outputPath('persisted-grid-inner-lane-crossing.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-grid-inner-lane-crossing', {
		path: screenshot,
		contentType: 'image/png',
	});
});

for (const orientation of [LaneOrientation.Parallel, LaneOrientation.Transverse]) {
	test(`persisted ${orientation} lanes stay inside their region while the source route crosses siblings`, async ({
		page,
	}, info) => {
		await page.setViewportSize({ width: 1920, height: 1200 });
		const room = `e2e-${crypto.randomUUID()}`;
		await seedRoom(room, CollaborativeFixture.LinkedBoxes, regionLaneDocument(room, orientation));
		await page.goto(`/atelier/collaboration?room=${room}`);
		await expect(page.locator('[data-graph-stage]')).toBeVisible();
		await expect(page.locator('[data-region-id]')).toHaveCount(3);
		await expect(page.locator('[data-lane-region-id="left"]')).toHaveCount(2);
		await expect(page.locator('[data-lane-id="sales"]')).toHaveCount(1);
		await expect(page.locator('[data-lane-id="service"]')).toHaveCount(1);
		await expect(page.locator('[data-relation-id="a-local"]')).toHaveCount(1);
		await expect(page.locator('[data-relation-id="a-c"]')).toHaveCount(1);
		await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
		await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
		await page.locator('[data-graph-stage]').evaluate(async (stage) => {
			await Promise.all(
				stage
					.getAnimations({ subtree: true })
					.map((animation) => animation.finished.catch(() => undefined)),
			);
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
		const left = await page.locator('[data-region-id="left"]').boundingBox();
		const middle = await page.locator('[data-region-id="middle"]').boundingBox();
		const right = await page.locator('[data-region-id="right"]').boundingBox();
		const viewportBounds = await viewport.boundingBox();
		if (left === null || middle === null || right === null || viewportBounds === null)
			throw new Error('Missing region or viewport frame');
		for (const [laneId, nodeId] of [
			['sales', 'a-source'],
			['service', 'a-target'],
		] as const) {
			const lane = await page.locator(`[data-lane-id="${laneId}"]`).boundingBox();
			const node = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
			if (lane === null || node === null)
				throw new Error(`Missing ${laneId} lane or ${nodeId} node`);
			expect(lane.x).toBeGreaterThanOrEqual(left.x);
			expect(lane.y).toBeGreaterThanOrEqual(left.y);
			expect(lane.x + lane.width).toBeLessThanOrEqual(left.x + left.width);
			expect(lane.y + lane.height).toBeLessThanOrEqual(left.y + left.height);
			expect(node.x).toBeGreaterThan(lane.x);
			expect(node.y).toBeGreaterThan(lane.y);
			expect(node.x + node.width).toBeLessThan(lane.x + lane.width);
			expect(node.y + node.height).toBeLessThan(lane.y + lane.height);
		}
		expect(left.x + left.width).toBeLessThan(middle.x);
		expect(right.x + right.width).toBeLessThan(viewportBounds.x + viewportBounds.width);
		const screenshot = info.outputPath(`persisted-region-${orientation}-lanes.png`);
		await page.screenshot({ path: screenshot });
		await info.attach(`persisted-region-${orientation}-lanes`, {
			path: screenshot,
			contentType: 'image/png',
		});
	});
}

test('three source regions render independently and the cross-region route avoids an opaque sibling', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, nestedRegionsDocument(room));
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(3);
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id="a-local"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="a-c"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
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
	const viewportBounds = await viewport.boundingBox();
	if (viewportBounds === null) throw new Error('Missing canvas viewport bounds');

	for (const [regionId, nodeIds] of [
		['left', ['a-source', 'a-target']],
		['middle', ['b']],
		['right', ['c']],
	] as const) {
		const region = await page.locator(`[data-region-id="${regionId}"]`).boundingBox();
		if (region === null) throw new Error(`Missing ${regionId} region bounds`);
		expect(region.x).toBeGreaterThan(viewportBounds.x);
		expect(region.x + region.width).toBeLessThan(viewportBounds.x + viewportBounds.width);
		expect(region.y).toBeGreaterThan(viewportBounds.y);
		expect(region.y + region.height).toBeLessThan(viewportBounds.y + viewportBounds.height);
		for (const nodeId of nodeIds) {
			const node = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
			if (node === null) throw new Error(`Missing ${nodeId} node bounds`);
			expect(node.x).toBeGreaterThan(region.x);
			expect(node.x + node.width).toBeLessThan(region.x + region.width);
			expect(node.y).toBeGreaterThan(region.y);
			expect(node.y + node.height).toBeLessThan(region.y + region.height);
		}
	}

	const middleIsOpaque = await page.evaluate(() => {
		const middle = document.querySelector<HTMLElement>('[data-region-id="middle"]');
		const route = document.querySelector<SVGPathElement>('[data-relation-id="a-c"]');
		if (middle === null || route === null) throw new Error('Missing middle region or route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route screen transform');
		const bounds = middle.getBoundingClientRect();
		const length = route.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = route.getPointAtLength((length * sample) / 128);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			if (
				screen.x > bounds.left + 1 &&
				screen.x < bounds.right - 1 &&
				screen.y > bounds.top + 1 &&
				screen.y < bounds.bottom - 1
			)
				return false;
		}
		return true;
	});
	expect(middleIsOpaque).toBe(true);

	const screenshot = info.outputPath('nested-regions-left-middle-right.png');
	await page.screenshot({ path: screenshot });
	await info.attach('nested-regions-left-middle-right', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('reverse flow routes from the lower portal without crossing another node in its own region', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(
		room,
		CollaborativeFixture.LinkedBoxes,
		nestedRegionsDocument(room, {
			direction: LayoutDirection.BottomToTop,
			bias: LayoutBias.Bottom,
		}),
	);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-region-id]')).toHaveCount(3);
	await expect(page.locator('[data-node-id]')).toHaveCount(4);
	await expect(page.locator('[data-relation-id]')).toHaveCount(2);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
	});
	const avoidsLocalNode = await page.evaluate(() => {
		const unrelated = document.querySelector<HTMLElement>('[data-node-id="a-source"]');
		const route = document.querySelector<SVGPathElement>('[data-relation-id="a-c"]');
		if (unrelated === null || route === null) throw new Error('Missing source node or route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route screen transform');
		const bounds = unrelated.getBoundingClientRect();
		const length = route.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = route.getPointAtLength((length * sample) / 128);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			if (
				screen.x > bounds.left + 1 &&
				screen.x < bounds.right - 1 &&
				screen.y > bounds.top + 1 &&
				screen.y < bounds.bottom - 1
			)
				return false;
		}
		return true;
	});
	expect(avoidsLocalNode).toBe(true);
	const screenshot = info.outputPath('nested-regions-reverse-flow.png');
	await page.screenshot({ path: screenshot });
	await info.attach('nested-regions-reverse-flow', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('an unsupported grandchild region reports a layout diagnostic without a stale scene', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = nestedRegionsDocument(room);
	const presentation = defined(source.regionPresentation);
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		regionPresentation: {
			...presentation,
			regions: [
				...presentation.regions,
				{
					id: 'left-inner',
					parentId: 'left',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
				},
			],
		},
		nodes: source.nodes.map((node) => {
			if (node.id === 'a-source') return { ...node, regionId: 'left-inner' };
			return node;
		}),
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-layout-diagnostic]')).toBeVisible();
	await expect(page.locator('[data-layout-reason="unsupported-region-layout"]')).toHaveCount(1);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	await expect(page.locator('[data-canvas-overlay]')).toHaveCount(0);
});

test('a persisted grandchild crosses its parent boundary to a root sibling', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = depthTwoRegionDocument();
	const persisted = persistedDepthTwoRegionDocument({
		...source,
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'grandchild-to-right', from: 'c', to: 'd' },
		],
	});
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persisted);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-relation-id="grandchild-to-right"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
	});
	await page.evaluate(() => {
		const route = document.querySelector<SVGPathElement>(
			'[data-relation-id="grandchild-to-right"]',
		);
		if (route === null) throw new Error('Missing grandchild route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const length = route.getTotalLength();
		for (const id of ['left', 'middle', 'far-right']) {
			const region = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
			if (region === null) throw new Error(`Missing region ${id}`);
			const bounds = region.getBoundingClientRect();
			for (let sample = 0; sample <= 128; sample += 1) {
				const point = route.getPointAtLength((length * sample) / 128);
				const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				if (
					screen.x > bounds.left + 1 &&
					screen.x < bounds.right - 1 &&
					screen.y > bounds.top + 1 &&
					screen.y < bounds.bottom - 1
				)
					throw new Error(`Grandchild route entered opaque region ${id}`);
			}
		}
	});
	const screenshot = info.outputPath('grandchild-to-root-sibling.png');
	await page.screenshot({ path: screenshot });
	await info.attach('grandchild-to-root-sibling', { path: screenshot, contentType: 'image/png' });
});

test('a persisted two-level tree renders six frames and routes at each common ancestor', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persistedDepthTwoRegionDocument());
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
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
	const proof = await page.evaluate(() => {
		const bounds = (selector: string): DOMRect => {
			const element = document.querySelector<HTMLElement>(selector);
			if (element === null) throw new Error(`Missing ${selector}`);
			return element.getBoundingClientRect();
		};
		const strictlyContains = (outer: DOMRect, inner: DOMRect): boolean =>
			inner.left > outer.left &&
			inner.right < outer.right &&
			inner.top > outer.top &&
			inner.bottom < outer.bottom;
		const branch = bounds('[data-region-id="branch"]');
		const children = ['left', 'middle', 'branch-right'];
		for (const id of children)
			if (!strictlyContains(branch, bounds(`[data-region-id="${id}"]`)))
				throw new Error(`${id} escaped branch`);
		for (const [regionId, nodeIds] of [
			['left', ['a-source', 'a-target']],
			['middle', ['b']],
			['branch-right', ['c']],
			['right', ['d']],
			['far-right', ['e']],
		] as const) {
			const frame = bounds(`[data-region-id="${regionId}"]`);
			for (const id of nodeIds)
				if (!strictlyContains(frame, bounds(`[data-node-id="${id}"]`)))
					throw new Error(`${id} escaped ${regionId}`);
		}
		const routeAvoids = (relationId: string, regionId: string): boolean => {
			const route = document.querySelector<SVGPathElement>(`[data-relation-id="${relationId}"]`);
			if (route === null) throw new Error(`Missing relation ${relationId}`);
			const matrix = route.getScreenCTM();
			if (matrix === null) throw new Error(`Missing transform for ${relationId}`);
			const frame = bounds(`[data-region-id="${regionId}"]`);
			const length = route.getTotalLength();
			for (let sample = 0; sample <= 128; sample += 1) {
				const point = route.getPointAtLength((length * sample) / 128);
				const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
				if (
					screen.x > frame.left + 1 &&
					screen.x < frame.right - 1 &&
					screen.y > frame.top + 1 &&
					screen.y < frame.bottom - 1
				)
					return false;
			}
			return true;
		};
		return {
			innerOpaque: routeAvoids('inside-branch', 'middle'),
			outerOpaque: routeAvoids('at-root', 'branch'),
		};
	});
	expect(proof).toEqual({ innerOpaque: true, outerOpaque: true });
	const screenshot = info.outputPath('nested-regions-depth-two.png');
	await page.screenshot({ path: screenshot });
	await info.attach('nested-regions-depth-two', { path: screenshot, contentType: 'image/png' });
});

test('a persisted grandchild receives and emits concurrent incidents without a bridge diagnostic', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedDepthTwoRegionDocument();
	const persisted = {
		...source,
		relations: [
			...source.relations.filter(({ id }) => id !== 'at-root'),
			{ id: 'grandchild-to-right', from: 'c', to: 'd' },
		],
	};
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, persisted);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-node-id]')).toHaveCount(6);
	await expect(page.locator('[data-relation-id]')).toHaveCount(3);
	await expect(page.locator('[data-relation-id="inside-branch"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="grandchild-to-right"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.allSettled(
			stage.getAnimations({ subtree: true }).map((animation) => animation.finished),
		);
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
	const proof = await page.evaluate(() => {
		const frame = document.querySelector<HTMLElement>('[data-region-id="middle"]');
		const route = document.querySelector<SVGPathElement>('[data-relation-id="inside-branch"]');
		if (frame === null || route === null) throw new Error('Missing nested incident witness.');
		const bounds = frame.getBoundingClientRect();
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing relation transform.');
		const length = route.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = route.getPointAtLength((length * sample) / 128);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			if (
				screen.x > bounds.left + 1 &&
				screen.x < bounds.right - 1 &&
				screen.y > bounds.top + 1 &&
				screen.y < bounds.bottom - 1
			)
				return false;
		}
		return true;
	});
	expect(proof).toBe(true);
	const screenshot = info.outputPath('nested-regions-concurrent-incidents.png');
	await page.screenshot({ path: screenshot });
	await info.attach('nested-regions-concurrent-incidents', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('a persisted internal grid attaches a group crossing without leaving its cell', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1800 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(
		room,
		CollaborativeFixture.LinkedBoxes,
		persistedNestedGridWithGroupPortalDocument(),
	);
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
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
		const grid = document.querySelector<HTMLElement>('[data-region-id="grid"]');
		const cell = document.querySelector<HTMLElement>('[data-region-id="b"]');
		const group = document.querySelector<HTMLElement>('[data-group-id="cell-group"]');
		const member = document.querySelector<HTMLElement>('[data-node-id="b"]');
		const route = document.querySelector<SVGPathElement>('[data-relation-id="group-crossing"]');
		if (grid === null || cell === null || group === null || member === null || route === null)
			throw new Error('Missing persisted internal group witness');
		const gridBounds = grid.getBoundingClientRect();
		const cellBounds = cell.getBoundingClientRect();
		const groupBounds = group.getBoundingClientRect();
		const memberBounds = member.getBoundingClientRect();
		if (
			cellBounds.left <= gridBounds.left ||
			cellBounds.right >= gridBounds.right ||
			cellBounds.top <= gridBounds.top ||
			cellBounds.bottom >= gridBounds.bottom
		)
			throw new Error('The group cell leaves its parent grid');
		if (
			groupBounds.left <= cellBounds.left ||
			groupBounds.right >= cellBounds.right ||
			groupBounds.top <= cellBounds.top ||
			groupBounds.bottom >= cellBounds.bottom
		)
			throw new Error('The group leaves its cell');
		if (
			memberBounds.left <= groupBounds.left ||
			memberBounds.right >= groupBounds.right ||
			memberBounds.top <= groupBounds.top ||
			memberBounds.bottom >= groupBounds.bottom
		)
			throw new Error('The member leaves its group');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const start = route.getPointAtLength(0);
		const contact = new DOMPoint(start.x, start.y).matrixTransform(matrix);
		if (
			Math.abs(contact.x - groupBounds.right) > 2 ||
			contact.y <= groupBounds.top ||
			contact.y >= groupBounds.bottom
		)
			throw new Error('The route does not attach to the group outside face');
		const length = route.getTotalLength();
		for (let sample = 0; sample <= 128; sample += 1) {
			const point = route.getPointAtLength((length * sample) / 128);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			for (const id of ['a', 'c', 'outside']) {
				const foreign = document.querySelector<HTMLElement>(`[data-region-id="${id}"]`);
				if (foreign === null) throw new Error(`Missing foreign region ${id}`);
				const bounds = foreign.getBoundingClientRect();
				if (
					screen.x > bounds.left + 1 &&
					screen.x < bounds.right - 1 &&
					screen.y > bounds.top + 1 &&
					screen.y < bounds.bottom - 1
				)
					throw new Error(`The group route entered foreign region ${id}`);
			}
		}
	});
	const screenshot = info.outputPath('persisted-internal-grid-group.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-internal-grid-group', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('a grouped member crosses its internal grid cell boundary', async ({ page }, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = persistedNestedGridWithGroupPortalDocument();
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		relations: [
			...source.relations.filter(({ id }) => id !== 'group-crossing'),
			{ id: 'member-crossing', from: 'b', to: 'd' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-region-id]')).toHaveCount(6);
	await expect(page.locator('[data-group-id="cell-group"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="member-crossing"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await expect(page.locator('[data-source-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
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
	const member = await page.locator('[data-node-id="b"]').boundingBox();
	const group = await page.locator('[data-group-id="cell-group"]').boundingBox();
	const cell = await page.locator('[data-region-id="b"]').boundingBox();
	if (member === null || group === null || cell === null)
		throw new Error('Missing grouped member or grid cell');
	expect(member.x).toBeGreaterThan(group.x);
	expect(member.x + member.width).toBeLessThan(group.x + group.width);
	expect(group.x).toBeGreaterThan(cell.x);
	expect(group.x + group.width).toBeLessThan(cell.x + cell.width);
	const contact = await page.locator('[data-relation-id="member-crossing"]').evaluate((route) => {
		if (!(route instanceof SVGPathElement)) throw new Error('Expected an SVG member route');
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing member route transform');
		const start = route.getPointAtLength(0);
		return new DOMPoint(start.x, start.y).matrixTransform(matrix).x;
	});
	expect(Math.abs(contact - (member.x + member.width))).toBeLessThanOrEqual(2);
	const screenshot = info.outputPath('persisted-internal-grid-group-member.png');
	await page.screenshot({ path: screenshot });
	await info.attach('persisted-internal-grid-group-member', {
		path: screenshot,
		contentType: 'image/png',
	});
});
