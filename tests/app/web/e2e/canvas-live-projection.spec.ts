import { writeFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
	defined,
	GroupState,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { seedRoom } from './collaboration-room';

test('remote text updates retain canvas DOM, focus, selection and zoom', async ({
	browser,
}, info) => {
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.TwoBoxes);
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	try {
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();
		await alice.goto(`/atelier/collaboration?room=${room}&name=Alice`);
		await bob.goto(`/atelier/collaboration?room=${room}&name=Bob`);
		const viewport = alice.locator('[data-canvas-viewport]');
		await expect(alice.locator('[data-graph-stage]')).toBeVisible();
		await viewport.dispatchEvent('wheel', {
			ctrlKey: true,
			deltaY: -100,
			clientX: 100,
			clientY: 100,
		});
		await expect(alice.locator('[data-graph-stage]')).toHaveCSS('transform', /^matrix\(1\.1,/);
		const zoom = await alice
			.locator('[data-graph-stage]')
			.evaluate((node) => getComputedStyle(node).transform);
		const selected = alice.locator('[data-node-id="B"]');
		await selected.click();
		await selected.focus();
		const element = defined(await selected.elementHandle());
		const stage = defined(await alice.locator('[data-graph-stage]').elementHandle());
		const revision = await viewport.getAttribute('data-canvas-revision');
		await bob.getByRole('button', { name: 'Modifier Boîte A', exact: true }).click();
		await bob.getByRole('textbox', { name: 'Contenu A', exact: true }).fill('Mise à jour distante');
		await expect(alice.locator('[data-node-id="A"]')).toContainText('Mise à jour distante');
		await expect(viewport).not.toHaveAttribute('data-canvas-revision', revision ?? '');
		expect(
			await element.evaluate((node) => node.isConnected && document.activeElement === node),
		).toBe(true);
		expect(await stage.evaluate((node) => node.isConnected)).toBe(true);
		await expect(selected).toHaveAttribute('aria-pressed', 'true');
		await expect(alice.locator('[data-graph-stage]')).toHaveCSS('transform', zoom);
		await expect(alice.getByText('Measuring document…', { exact: true })).toHaveCount(0);
		const timings = await alice.evaluate(() =>
			performance.getEntriesByName('sequit:canvas-projection').map(({ duration }) => duration),
		);
		expect(timings).toHaveLength(1);
		const reportPath = info.outputPath('browser-projection.json');
		await writeFile(reportPath, JSON.stringify(timings));
		await info.attach('canvas-projection-ms', {
			path: reportPath,
			contentType: 'application/json',
		});
	} finally {
		await Promise.allSettled([aliceContext.close(), bobContext.close()]);
	}
});

test('a collapsed aggregate can be deleted without exposing or retargeting its hidden nodes', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, room);
	const template = defined(source.nodes[0]);
	await seedRoom(room, CollaborativeFixture.OpenGroup, {
		...source,
		groups: source.groups.map((group) => ({
			...group,
			state: GroupState.Closed,
		})),
		nodes: [
			...source.nodes,
			{
				kind: template.kind,
				natureId: template.natureId,
				id: 'C',
				markdown: 'Outside',
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'one', from: 'C', to: 'A' },
			{ id: 'two', from: 'C', to: 'B' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-node-id]')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Modifier Boîte A', exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(1);
	await page.getByRole('button', { name: 'Modifier Relation one', exact: true }).click();
	await expect(page.getByLabel('Destination de one', { exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Supprimer la relation one', exact: true }).click();
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(0);
	await page.getByRole('button', { name: 'Modifier Groupe G', exact: true }).click();
	await page.getByRole('button', { name: 'Déplier G', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(page.getByLabel('Relations').getByRole('listitem')).toHaveCount(0);
});

test('a source-valid false cycle stays folded and keeps both visible relation paths', async ({
	page,
}, info) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, room);
	const template = defined(source.nodes[0]);
	await seedRoom(room, CollaborativeFixture.OpenGroup, {
		...source,
		groups: source.groups.map((group) => ({
			...group,
			state: GroupState.Closed,
		})),
		nodes: [
			...source.nodes,
			{
				kind: template.kind,
				natureId: template.natureId,
				id: 'C',
				markdown: 'Outside',
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'one', from: 'B', to: 'C' },
			{ id: 'two', from: 'C', to: 'A' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-group-id="G"]')).toHaveCount(1);
	await expect(page.locator('[data-node-id]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="one"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="two"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	const screenshot = info.outputPath('folded-source-cycle.png');
	await page.screenshot({ path: screenshot });
	await info.attach('folded-source-cycle', {
		path: screenshot,
		contentType: 'image/png',
	});
	await page.getByRole('button', { name: 'Modifier Groupe G', exact: true }).click();
	await page.getByRole('button', { name: 'Déplier G', exact: true }).click();
	await expect(page.locator('[data-node-id]')).toHaveCount(3);
	await expect(page.locator('[data-relation-id="one"]')).toHaveCount(1);
	await expect(page.locator('[data-relation-id="two"]')).toHaveCount(1);
});

test('an unresolved folded shape publishes a diagnostic without a stale canvas', async ({
	page,
}) => {
	const room = `e2e-${crypto.randomUUID()}`;
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, room);
	const outside = defined(collaborativeFixture(CollaborativeFixture.TwoBoxes, room).nodes[0]);
	await seedRoom(room, CollaborativeFixture.OpenGroup, {
		...source,
		groups: source.groups.map((group) => ({
			...group,
			state: GroupState.Closed,
		})),
		nodes: [
			...source.nodes,
			{ ...outside, id: 'C', layoutOrder: orderKey('a3') },
			{ ...outside, id: 'D', layoutOrder: orderKey('a4') },
		],
		relations: [
			{ id: 'one', from: 'B', to: 'C' },
			{ id: 'two', from: 'C', to: 'A' },
		],
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-layout-diagnostic]')).toBeVisible();
	await expect(page.locator('[data-layout-reason="unknown-folded-group-layout"]')).toHaveCount(1);
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	await expect(page.locator('[data-canvas-overlay]')).toHaveCount(0);
});

test('a relation crosses the free space of a separating lane in both orientations', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	for (const laneOrientation of [LaneOrientation.Parallel, LaneOrientation.Transverse]) {
		const room = `e2e-${crypto.randomUUID()}`;
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, room);
		const outside = defined(source.nodes[0]);
		await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
					{ id: 'middle', label: 'Middle', layoutOrder: orderKey('a1') },
					{ id: 'right', label: 'Right', layoutOrder: orderKey('a2') },
				],
			},
			nodes: [
				...source.nodes.map((node) => {
					let laneId = 'right';
					if (node.id === 'B') laneId = 'left';
					return { ...node, laneId };
				}),
				{ ...outside, id: 'C', laneId: 'middle', layoutOrder: orderKey('a3') },
			],
		});
		await page.goto(`/atelier/collaboration?room=${room}`);
		await expect(page.locator('[data-graph-stage]')).toBeVisible();
		await expect(page.locator('[data-lane-id]')).toHaveCount(3);
		await expect(page.locator('[data-node-id]')).toHaveCount(3);
		await expect(page.locator('[data-relation-id="R"]')).toHaveCount(1);
		await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
		await page.locator('[data-graph-stage]').evaluate(async (stage) => {
			await Promise.all(
				stage
					.getAnimations({ subtree: true })
					.map((animation) => animation.finished.catch(() => undefined)),
			);
		});
		for (const [laneId, nodeId] of [
			['left', 'B'],
			['middle', 'C'],
			['right', 'A'],
		] as const) {
			const lane = await page.locator(`[data-lane-id="${laneId}"]`).boundingBox();
			const node = await page.locator(`[data-node-id="${nodeId}"]`).boundingBox();
			if (lane === null || node === null) throw new Error('Expected visible lane and node bounds');
			expect(node.x).toBeGreaterThan(lane.x);
			expect(node.x + node.width).toBeLessThan(lane.x + lane.width);
			expect(node.y).toBeGreaterThan(lane.y);
			expect(node.y + node.height).toBeLessThan(lane.y + lane.height);
		}
		const screenshot = info.outputPath(`shared-lanes-${laneOrientation}.png`);
		await page.screenshot({ path: screenshot });
		await info.attach(`shared-lanes-${laneOrientation}`, {
			path: screenshot,
			contentType: 'image/png',
		});
	}
});

test('an intra-lane relation reaches its parent between their rows without leaving the lane', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	const room = `e2e-${crypto.randomUUID()}`;
	const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, room);
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
		...source,
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
				{ id: 'right', label: 'Right', layoutOrder: orderKey('a1') },
			],
		},
		nodes: source.nodes.map((node) => ({ ...node, laneId: 'left' })),
	});
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-graph-stage]')).toBeVisible();
	await expect(page.locator('[data-lane-id]')).toHaveCount(2);
	await expect(page.locator('[data-relation-id="R"]')).toHaveCount(1);
	await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
	await page.locator('[data-graph-stage]').evaluate(async (stage) => {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
	});
	const lane = await page.locator('[data-lane-id="left"]').boundingBox();
	const parent = await page.locator('[data-node-id="A"]').boundingBox();
	const child = await page.locator('[data-node-id="B"]').boundingBox();
	if (lane === null || parent === null || child === null)
		throw new Error('Expected visible lane and node bounds');
	const samples = await page.locator('[data-relation-id="R"]').evaluate((route: SVGPathElement) => {
		const matrix = route.getScreenCTM();
		if (matrix === null) throw new Error('Missing route transform');
		const length = route.getTotalLength();
		return Array.from({ length: 65 }, (_, sample) => {
			const point = route.getPointAtLength((length * sample) / 64);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
			return { x: screen.x, y: screen.y };
		});
	});
	// One straight segment from the child's top face up to the parent's bottom face, inside the lane.
	for (const point of samples) {
		expect(point.x).toBeGreaterThan(Math.max(lane.x, parent.x, child.x));
		expect(point.x).toBeLessThan(
			Math.min(lane.x + lane.width, parent.x + parent.width, child.x + child.width),
		);
		expect(point.y).toBeGreaterThanOrEqual(parent.y + parent.height - 1);
		expect(point.y).toBeLessThanOrEqual(child.y + 1);
	}
	const screenshot = info.outputPath('intra-lane-relation.png');
	await page.screenshot({ path: screenshot });
	await info.attach('intra-lane-relation', { path: screenshot, contentType: 'image/png' });
});

test('the four-message S | SD | C process renders through the shared lane policy', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1920, height: 1200 });
	for (const laneOrientation of [LaneOrientation.Transverse, LaneOrientation.Parallel]) {
		const room = `e2e-${crypto.randomUUID()}`;
		const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, room);
		const base = defined(source.nodes[0]);
		await seedRoom(room, CollaborativeFixture.LinkedBoxes, {
			...source,
			persistenceFormat: LANE_PERSISTENCE_FORMAT,
			presentation: {
				schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
				policy: LayoutPolicy.Layered,
				laneOrientation,
				growth: LaneGrowth.Auto,
				lanes: [
					{ id: 'S', label: 'S', layoutOrder: orderKey('a0') },
					{ id: 'SD', label: 'SD', layoutOrder: orderKey('a1') },
					{ id: 'C', label: 'C', layoutOrder: orderKey('a2') },
				],
			},
			nodes: [
				{
					...base,
					id: 'c-request',
					laneId: 'C',
					markdown: 'Request',
					layoutOrder: orderKey('a0'),
				},
				{
					...base,
					id: 's-receive',
					laneId: 'S',
					markdown: 'Receive',
					layoutOrder: orderKey('a1'),
				},
				{
					...base,
					id: 'sd-work',
					laneId: 'SD',
					markdown: 'Work',
					layoutOrder: orderKey('a2'),
				},
				{
					...base,
					id: 's-reply',
					laneId: 'S',
					markdown: 'Reply',
					layoutOrder: orderKey('a3'),
				},
				{
					...base,
					id: 'c-done',
					laneId: 'C',
					markdown: 'Done',
					layoutOrder: orderKey('a4'),
				},
			],
			relations: [
				{ id: 'request', from: 'c-request', to: 's-receive' },
				{ id: 'dispatch', from: 's-receive', to: 'sd-work' },
				{ id: 'completion', from: 'sd-work', to: 's-reply' },
				{ id: 'response', from: 's-reply', to: 'c-done' },
			],
		});
		await page.goto(`/atelier/collaboration?room=${room}`);
		await expect(page.locator('[data-graph-stage]')).toBeVisible();
		await expect(page.locator('[data-layout-diagnostic]')).toHaveCount(0);
		await expect(page.locator('[data-lane-id]')).toHaveCount(3);
		await expect(page.locator('[data-node-id]')).toHaveCount(5);
		for (const relationId of ['request', 'dispatch', 'completion', 'response'])
			await expect(page.locator(`[data-relation-id="${relationId}"]`)).toHaveCount(1);
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
		const screenshot = info.outputPath(`process-s-sd-c-${laneOrientation}.png`);
		await page.screenshot({ path: screenshot });
		await info.attach(`process-s-sd-c-${laneOrientation}`, {
			path: screenshot,
			contentType: 'image/png',
		});
	}
});
