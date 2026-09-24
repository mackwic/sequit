import { expect, test } from '@playwright/test';
import type { Component } from 'svelte';

import type { CanvasProjection } from '../../../../src/app/web/projection/canvas-projection';
import type { CanvasSession } from '../../../../src/app/web/ui/session/canvas-session.svelte';
import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	regionLanePartialDocument,
	regionLanePartialSubtreeDocument,
} from '../../../support/builders/region-lane-document';
import { CollaborativeFixture } from '../../../support/fixtures/collaborative-document';
import type {
	mount as svelteMount,
	unmount as svelteUnmount,
} from '../../../support/harnesses/browser-svelte-runtime';
import { seedRoom } from './collaboration-room';

test('a current healthy leaf remains visible through a sibling layout failure and recovery', async ({
	page,
}) => {
	await page.goto('/');
	const selected = regionLanePartialDocument(false);
	const unresolved = regionLanePartialDocument(true);
	const changed: LogicDocument = {
		...unresolved,
		nodes: unresolved.nodes.map((node) => {
			if (node.id !== 'neighbor') return node;
			return {
				...node,
				id: 'current-neighbor',
				markdown: 'Current neighbor\n',
			};
		}),
	};
	const observed = await page.evaluate(
		async ({ selected, changed }) => {
			function callable(value: unknown, key: string): boolean {
				if (typeof value !== 'object') return false;
				if (value === null) return false;
				if (!(key in value)) return false;
				const member: unknown = Reflect.get(value, key);
				return typeof member === 'function';
			}
			function isProjectionModule(value: unknown): value is {
				createSharedCanvasProjection: (document: LogicDocument) => CanvasProjection & {
					update(document: LogicDocument): void;
				};
			} {
				return callable(value, 'createSharedCanvasProjection');
			}
			function isCanvasModule(value: unknown): value is {
				default: Component<{ document: CanvasProjection; session: CanvasSession }>;
			} {
				return callable(value, 'default');
			}
			function isSessionModule(value: unknown): value is {
				CanvasSession: new () => CanvasSession;
			} {
				return callable(value, 'CanvasSession');
			}
			function isRuntimeModule(value: unknown): value is {
				mount: typeof svelteMount;
				unmount: typeof svelteUnmount;
			} {
				return callable(value, 'mount') && callable(value, 'unmount');
			}
			const load = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);
			const projectionModule = await load('/src/app/web/projection/open-document.ts');
			const canvasModule = await load('/src/app/web/ui/components/canvas/LogicCanvas.svelte');
			const sessionModule = await load('/src/app/web/ui/session/canvas-session.svelte.ts');
			const runtime = await load('/tests/support/harnesses/browser-svelte-runtime.ts');
			if (!isProjectionModule(projectionModule)) throw new Error('Invalid projection module');
			if (!isCanvasModule(canvasModule)) throw new Error('Invalid canvas module');
			if (!isSessionModule(sessionModule)) throw new Error('Invalid session module');
			if (!isRuntimeModule(runtime)) throw new Error('Invalid Svelte runtime module');
			const host = document.createElement('div');
			document.body.appendChild(host);
			const projection = projectionModule.createSharedCanvasProjection(selected);
			const component = runtime.mount(canvasModule.default, {
				target: host,
				props: {
					document: projection,
					session: new sessionModule.CanvasSession(),
				},
			});
			async function until(selector: string): Promise<void> {
				const deadline = performance.now() + 5_000;
				while (host.querySelector(selector) === null) {
					if (performance.now() > deadline) throw new Error(`Timed out waiting for ${selector}`);
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			await until('[data-graph-stage] [data-node-id="neighbor"]');
			projection.update(changed);
			await until('[data-partial-region-id="ordinary"][data-partial-region-status="ready"]');
			const partial = {
				rootReason: host.querySelector('[data-layout-reason]')?.getAttribute('data-layout-reason'),
				sharedReason: host
					.querySelector('[data-partial-region-id="shared"] [data-partial-region-reason]')
					?.getAttribute('data-partial-region-reason'),
				currentNeighbor: host.querySelector('[data-preview-node-id="current-neighbor"]') !== null,
				oldNeighbor: host.querySelector('[data-preview-node-id="neighbor"]') !== null,
				oldScene: host.querySelector('[data-graph-stage]') !== null,
				overlay: host.querySelector('[data-canvas-overlay]') !== null,
				foreignRoute: host.querySelector('[data-preview-relation-id="first-handoff"]') !== null,
			};
			projection.update(selected);
			await until('[data-graph-stage] [data-node-id="neighbor"]');
			const recovered = {
				stage: host.querySelector('[data-graph-stage]') !== null,
				partial: host.querySelector('[data-partial-regions]') !== null,
				diagnostic: host.querySelector('[data-layout-diagnostic]') !== null,
			};
			await runtime.unmount(component);
			host.remove();
			return { partial, recovered };
		},
		{ selected, changed },
	);
	expect(observed.partial).toEqual({
		rootReason: 'unknown-region-layout',
		sharedReason: 'unknown-leaf-layout',
		currentNeighbor: true,
		oldNeighbor: false,
		oldScene: false,
		overlay: false,
		foreignRoute: false,
	});
	expect(observed.recovered).toEqual({
		stage: true,
		partial: false,
		diagnostic: false,
	});
});

test('a persisted unresolved region shows independent local previews in the workspace', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, regionLanePartialDocument(true));
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-layout-reason="unknown-region-layout"]')).toBeVisible();
	await expect(page.locator('[data-partial-region-id="shared"]')).toHaveAttribute(
		'data-partial-region-status',
		'diagnostic',
	);
	await expect(page.locator('[data-partial-region-id="ordinary"]')).toHaveAttribute(
		'data-partial-region-status',
		'ready',
	);
	await expect(page.locator('[data-preview-node-id="neighbor"]')).toBeVisible();
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	await expect(page.locator('[data-canvas-overlay]')).toHaveCount(0);
	const screenshot = info.outputPath('partial-region-current-document.png');
	await page.screenshot({ path: screenshot });
	await info.attach('partial-region-current-document', {
		path: screenshot,
		contentType: 'image/png',
	});
});

test('a persisted unresolved sibling keeps the complete route of a closed branch visible', async ({
	page,
}, info) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	const room = `e2e-${crypto.randomUUID()}`;
	await seedRoom(room, CollaborativeFixture.LinkedBoxes, regionLanePartialSubtreeDocument(true));
	await page.goto(`/atelier/collaboration?room=${room}`);
	await expect(page.locator('[data-layout-reason="unknown-region-layout"]')).toBeVisible();
	const branch = page.locator('[data-partial-region-id="branch"]');
	await expect(branch).toHaveAttribute('data-partial-region-status', 'ready');
	await expect(branch.locator('[data-preview-node-id="neighbor"]')).toBeVisible();
	await expect(branch.locator('[data-preview-node-id="mate-node"]')).toBeVisible();
	await expect(branch.locator('[data-preview-relation-id="inside-branch"]')).toBeVisible();
	await expect(page.locator('[data-partial-region-id="ordinary"]')).toHaveCount(0);
	await expect(page.locator('[data-preview-relation-id="first-handoff"]')).toHaveCount(0);
	await expect(page.locator('[data-graph-stage]')).toHaveCount(0);
	const screenshot = info.outputPath('partial-closed-subtree.png');
	await page.screenshot({ path: screenshot });
	await info.attach('partial-closed-subtree', {
		path: screenshot,
		contentType: 'image/png',
	});
});
