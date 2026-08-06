import { expect, test } from '@playwright/test';
import type { Component } from 'svelte';

import type { CanvasModel } from '../../src/lib/canvas/canvas-model';
import type { OpenDocumentResult } from '../../src/lib/document/open-document';

const twoByTwoInversionDocument = `
persistenceFormat = 2

[document]
id = "two-by-two-inversion"
title = "Two by two inversion"

[layout]
direction = "top-to-bottom"
bias = "top"

[natures.goal]
label = "Goal"
color = "#12c930"

[groups]

[nodes.source-a]
nature = "goal"
markdown = "Source A"
layoutOrder = "a0"

[nodes.source-b]
nature = "goal"
markdown = "Source B"
layoutOrder = "a1"

[nodes.target-a]
nature = "goal"
markdown = "Target A"
layoutOrder = "a2"

[nodes.target-b]
nature = "goal"
markdown = "Target B"
layoutOrder = "a3"

[nodes.target-c]
nature = "goal"
markdown = "Target C"
layoutOrder = "a4"

[nodes.successor]
nature = "goal"
markdown = "Successor"
layoutOrder = "a5"

[junctions]

[relations.source-a-to-target-b]
from = "source-a"
to = "target-b"

[relations.source-b-to-target-a]
from = "source-b"
to = "target-a"

[relations.source-b-to-target-c]
from = "source-b"
to = "target-c"

[relations.target-a-to-successor]
from = "target-a"
to = "successor"

[relations.target-b-to-successor]
from = "target-b"
to = "successor"

[relations.target-c-to-successor]
from = "target-c"
to = "successor"
`;

test.describe('AI for documentary effort', () => {
	test('opens the real document and renders its connected dependency graph', async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');

		await expect(page.locator('[data-node-id]')).toHaveCount(24);
		await expect(page.locator('[data-group-id]')).toHaveCount(2);
		await expect(page.locator('[data-junction-id="word-ui-options"]')).toHaveCount(1);
		await expect(page.locator('[data-relation-id]')).toHaveCount(20);
		await expect(page.locator('[data-node-id="reduce-documentary-effort"]')).toContainText(
			'Apply AI to reduce the documentary effort on the whole pipeline',
		);
		await expect(page.locator('[data-group-id="data-team"]')).toContainText('Data team');
		await expect(
			page.locator(
				'[data-relation-id="data-team-to-ai-content-generation"][data-edge-from="data-team"][data-edge-to="ai-content-generation"]',
			),
		).toHaveCount(1);
		await expect(
			page.locator(
				'[data-relation-id="word-ui-options-to-familiar-word-ui"][data-edge-from="word-ui-options"][data-edge-to="familiar-word-ui"]',
			),
		).toHaveCount(1);

		const geometry = await page.evaluate(() => {
			function endpoint(id: string): HTMLElement {
				const value = document.querySelector<HTMLElement>(
					`[data-node-id="${id}"], [data-group-id="${id}"], [data-junction-id="${id}"]`,
				);
				if (!value) throw new Error(`Missing endpoint ${id}`);
				return value;
			}
			function onBoundary(x: number, y: number, element: HTMLElement): boolean {
				const left = Number.parseFloat(element.style.left);
				const top = Number.parseFloat(element.style.top);
				const right = left + Number.parseFloat(element.style.width);
				const bottom = top + Number.parseFloat(element.style.height);
				const tolerance = 0.1;
				const withinX = x >= left - tolerance && x <= right + tolerance;
				const withinY = y >= top - tolerance && y <= bottom + tolerance;
				return (
					(withinX && (Math.abs(y - top) < tolerance || Math.abs(y - bottom) < tolerance)) ||
					(withinY && (Math.abs(x - left) < tolerance || Math.abs(x - right) < tolerance))
				);
			}

			const connections = [...document.querySelectorAll<SVGPathElement>('[data-relation-id]')].map(
				(path) => {
					const from = path.dataset['edgeFrom'];
					const to = path.dataset['edgeTo'];
					const points = (path.getAttribute('d')?.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
					if (
						from === undefined ||
						from.length === 0 ||
						to === undefined ||
						to.length === 0 ||
						points.length < 4
					)
						return false;
					return (
						onBoundary(points[0] ?? 0, points[1] ?? 0, endpoint(from)) &&
						onBoundary(points[points.length - 2] ?? 0, points[points.length - 1] ?? 0, endpoint(to))
					);
				},
			);
			const useCases = endpoint('use-cases').getBoundingClientRect();
			const member = endpoint('traceable-edits').getBoundingClientRect();
			const dataTeam = endpoint('data-team');
			const aiContent = endpoint('ai-content-generation');
			const goal = endpoint('reduce-documentary-effort');
			const firstRankTopEdges = [
				'alcoa-plus',
				'preserve-partner-content',
				'docx-word-compatible',
				'data-team',
				'prompt-management',
			].map((id) => endpoint(id).offsetTop);
			return {
				allConnectionsTouchEndpoints: connections.every(Boolean),
				memberInsideGroup:
					member.left > useCases.left &&
					member.right < useCases.right &&
					member.top > useCases.top &&
					member.bottom < useCases.bottom,
				emptyGroupHasBounds: dataTeam.offsetWidth > 0 && dataTeam.offsetHeight > 0,
				bottomToTop:
					aiContent.offsetTop < dataTeam.offsetTop && goal.offsetTop < aiContent.offsetTop,
				topBiasedRankAligned: new Set(firstRankTopEdges).size === 1,
			};
		});

		expect(geometry).toEqual({
			allConnectionsTouchEndpoints: true,
			memberInsideGroup: true,
			emptyGroupHasBounds: true,
			bottomToTop: true,
			topBiasedRankAligned: true,
		});
	});

	test('rejects a keyless source while preserving the persisted endpoint order', async ({
		page,
	}) => {
		await page.goto('/examples/ai-documentary-effort');
		await expect(page.locator('[data-status="connected"]')).toBeVisible();

		const sourceContract = await page.evaluate(async () => {
			const importModule = (specifier: string): Promise<unknown> =>
				import(/* @vite-ignore */ specifier);
			const sourceModule = (await importModule('/src/lib/document/example-document.ts')) as {
				AI_DOCUMENTARY_EFFORT_SOURCE: string;
			};
			const openDocumentModule = (await importModule('/src/lib/document/open-document.ts')) as {
				openDocument: (source: string) => OpenDocumentResult;
			};
			const keylessSource = sourceModule.AI_DOCUMENTARY_EFFORT_SOURCE.replace(
				/^layoutOrder = ".*"\n/gm,
				'',
			);
			const keylessResult = openDocumentModule.openDocument(keylessSource);
			const persistedResult = openDocumentModule.openDocument(
				sourceModule.AI_DOCUMENTARY_EFFORT_SOURCE,
			);
			if (!persistedResult.ok) throw new Error('Failed to open persisted reference document');
			persistedResult.value.destroy();
			return {
				persistedOpened: true,
				keylessDiagnostics: keylessResult.ok ? [] : keylessResult.diagnostics,
			};
		});

		const persistedOrder = await page.evaluate(() => {
			function endpoint(id: string): HTMLElement {
				const value = document.querySelector<HTMLElement>(
					`[data-node-id="${id}"], [data-group-id="${id}"], [data-junction-id="${id}"]`,
				);
				if (!value) throw new Error(`Missing endpoint ${id}`);
				return value;
			}
			return [
				'preserve-documentary-guarantees',
				'minimal-workflow-disruption',
				'ai-content-generation',
			].toSorted((left, right) => endpoint(left).offsetLeft - endpoint(right).offsetLeft);
		});

		expect(sourceContract.persistedOpened).toBe(true);
		expect(sourceContract.keylessDiagnostics).toHaveLength(27);
		expect(sourceContract.keylessDiagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'missing-field',
					message: 'nodes.ai-content-generation.layoutOrder must be a string',
					path: ['nodes', 'ai-content-generation', 'layoutOrder'],
				}),
			]),
		);
		expect(
			sourceContract.keylessDiagnostics.every(
				(diagnostic) =>
					diagnostic.code === 'missing-field' &&
					diagnostic.path.at(-1) === 'layoutOrder' &&
					diagnostic.message.endsWith('.layoutOrder must be a string'),
			),
		).toBe(true);
		expect(persistedOrder).toEqual([
			'preserve-documentary-guarantees',
			'minimal-workflow-disruption',
			'ai-content-generation',
		]);
	});

	test('renders the crossing-aware editing pipeline in a browser integration', async ({ page }) => {
		await page.goto('/examples/ai-documentary-effort');
		await expect(page.locator('[data-status="connected"]')).toBeVisible();

		await page.evaluate(async (source) => {
			const importModule = (specifier: string): Promise<unknown> =>
				import(/* @vite-ignore */ specifier);
			const openDocumentModule = (await importModule('/src/lib/document/open-document.ts')) as {
				openDocument: (source: string) => OpenDocumentResult;
			};
			const renderedCanvasModule = (await importModule(
				'/src/lib/components/canvas/RenderedCanvas.svelte',
			)) as { default: Component<{ canvas: CanvasModel }> };
			const svelteModule = (await importModule('/@id/svelte')) as {
				mount: (
					component: Component<{ canvas: CanvasModel }>,
					options: { target: Element; props: { canvas: CanvasModel } },
				) => unknown;
			};
			const { openDocument } = openDocumentModule;
			const { default: RenderedCanvas } = renderedCanvasModule;
			const { mount } = svelteModule;
			const result = openDocument(source);
			if (!result.ok) throw new Error('Failed to open crossing-aware E2E fixture');
			const opened = result.value;
			const measurements = {
				nodes: new Map(
					opened.measurementModel.nodes.map(({ id }, index) => [
						id,
						{ width: 180, height: id === 'source-b' ? 104 : 80 + (index % 2) * 8 },
					]),
				),
				groups: new Map(),
				junctions: new Map(),
			};
			const renderStates: [string, CanvasModel][] = [];
			const capture = async (state: string) => {
				renderStates.push([state, await opened.createCanvasModel(measurements)]);
			};
			await capture('initial');
			await opened.addNode({ id: 'zz-added-first', natureId: 'goal', markdown: 'Added first' });
			measurements.nodes.set('zz-added-first', { width: 180, height: 80 });
			await capture('first-added');
			await opened.addNode({ id: 'aa-added-second', natureId: 'goal', markdown: 'Added second' });
			measurements.nodes.set('aa-added-second', { width: 180, height: 88 });
			await capture('appended');
			await opened.addRelation({
				id: 'zz-added-first-to-successor',
				from: 'zz-added-first',
				to: 'successor',
			});
			await opened.addRelation({
				id: 'aa-added-second-to-successor',
				from: 'aa-added-second',
				to: 'successor',
			});
			await capture('before');
			await opened.addRelation({
				id: 'qualifying-source-b-to-target-a',
				from: 'source-b',
				to: 'target-a',
			});
			await capture('after');
			await capture('stable');
			const fixture = document.createElement('section');
			fixture.dataset.crossingAwareFixture = '';
			document.body.replaceChildren(fixture);
			for (const [state, canvas] of renderStates) {
				const host = document.createElement('div');
				host.dataset.renderState = state;
				fixture.appendChild(host);
				mount(RenderedCanvas, { target: host, props: { canvas } });
			}
			opened.destroy();
		}, twoByTwoInversionDocument);

		const rendererContract = await page.evaluate(() => {
			function state(name: string): HTMLElement {
				const value = document.querySelector<HTMLElement>(`[data-render-state="${name}"]`);
				if (!value) throw new Error(`Missing ${name} render state`);
				return value;
			}
			function endpoint(root: HTMLElement, id: string): HTMLElement {
				const value = root.querySelector<HTMLElement>(
					`[data-node-id="${id}"], [data-group-id="${id}"], [data-junction-id="${id}"]`,
				);
				if (!value) throw new Error(`Missing endpoint ${id}`);
				return value;
			}
			function orderedTargets(root: HTMLElement): readonly string[] {
				return ['target-a', 'target-b', 'target-c'].toSorted(
					(left, right) => endpoint(root, left).offsetLeft - endpoint(root, right).offsetLeft,
				);
			}
			function ordered(root: HTMLElement, ids: readonly string[]): readonly string[] {
				return ids.toSorted(
					(left, right) => endpoint(root, left).offsetLeft - endpoint(root, right).offsetLeft,
				);
			}
			function inversionCrossings(root: HTMLElement): number {
				const relations = [...root.querySelectorAll<SVGPathElement>('[data-relation-id]')]
					.map((path) => ({ from: path.dataset.edgeFrom, to: path.dataset.edgeTo }))
					.filter((relation): relation is { from: string; to: string } =>
						Boolean(relation.from?.startsWith('source-') && relation.to?.startsWith('target-')),
					);
				let crossings = 0;
				for (let left = 0; left < relations.length; left += 1) {
					for (let right = left + 1; right < relations.length; right += 1) {
						const first = relations[left];
						const second = relations[right];
						if (first.from === second.from || first.to === second.to) continue;
						const sourceDelta =
							endpoint(root, first.from).offsetLeft - endpoint(root, second.from).offsetLeft;
						const targetDelta =
							endpoint(root, first.to).offsetLeft - endpoint(root, second.to).offsetLeft;
						if (sourceDelta * targetDelta < 0) crossings += 1;
					}
				}
				return crossings;
			}
			function routeContract(root: HTMLElement) {
				return [...root.querySelectorAll<SVGPathElement>('[data-relation-id]')].map((path) => {
					const from = path.dataset.edgeFrom;
					const to = path.dataset.edgeTo;
					const d = path.getAttribute('d') ?? '';
					const coordinates = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
					const points = Array.from({ length: coordinates.length / 2 }, (_, index) => ({
						x: coordinates[index * 2],
						y: coordinates[index * 2 + 1],
					}));
					function touchesBoundary(point: { x: number; y: number }, element: HTMLElement) {
						const left = Number.parseFloat(element.style.left);
						const top = Number.parseFloat(element.style.top);
						const right = left + Number.parseFloat(element.style.width);
						const bottom = top + Number.parseFloat(element.style.height);
						const tolerance = 0.1;
						const withinX = point.x >= left - tolerance && point.x <= right + tolerance;
						const withinY = point.y >= top - tolerance && point.y <= bottom + tolerance;
						return (
							(withinX &&
								(Math.abs(point.y - top) < tolerance || Math.abs(point.y - bottom) < tolerance)) ||
							(withinY &&
								(Math.abs(point.x - left) < tolerance || Math.abs(point.x - right) < tolerance))
						);
					}
					const firstPoint = points[0];
					const lastPoint = points.at(-1);
					const endpointContact =
						from !== undefined &&
						to !== undefined &&
						lastPoint !== undefined &&
						touchesBoundary(firstPoint, endpoint(root, from)) &&
						touchesBoundary(lastPoint, endpoint(root, to));
					return {
						fourPointLinePath: /^M(?:\s-?\d+(?:\.\d+)?){2}(?:\sL(?:\s-?\d+(?:\.\d+)?){2}){3}$/.test(
							d,
						),
						orthogonal: points.slice(1).every((point, index) => {
							const previous = points[index];
							return previous.x === point.x || previous.y === point.y;
						}),
						endpointContact,
					};
				});
			}

			const before = state('before');
			const after = state('after');
			const stable = state('stable');
			const peerIds = ['target-b', 'target-c'];
			return {
				initialOrder: ordered(state('initial'), ['source-a', 'source-b', 'target-a']),
				firstAddedOrder: ordered(state('first-added'), ['source-a', 'source-b', 'zz-added-first']),
				appendedOrder: ordered(state('appended'), [
					'source-a',
					'source-b',
					'zz-added-first',
					'aa-added-second',
				]),
				beforeOrder: orderedTargets(before),
				afterOrder: orderedTargets(after),
				stableOrder: orderedTargets(stable),
				peersBefore: ordered(before, peerIds),
				peersAfter: ordered(after, peerIds),
				beforeCrossings: inversionCrossings(before),
				afterCrossings: inversionCrossings(after),
				topBiasedRankAligned:
					new Set(['source-a', 'source-b'].map((id) => endpoint(after, id).offsetTop)).size === 1,
				routes: [...routeContract(before), ...routeContract(after), ...routeContract(stable)],
			};
		});

		expect(rendererContract.initialOrder).toEqual(['target-a', 'source-a', 'source-b']);
		expect(rendererContract.firstAddedOrder).toEqual(['source-a', 'source-b', 'zz-added-first']);
		expect(rendererContract.appendedOrder).toEqual([
			'source-a',
			'source-b',
			'zz-added-first',
			'aa-added-second',
		]);
		expect(rendererContract.beforeOrder).toEqual(['target-a', 'target-b', 'target-c']);
		expect(rendererContract.afterOrder).toEqual(['target-b', 'target-a', 'target-c']);
		expect(rendererContract.stableOrder).toEqual(rendererContract.afterOrder);
		expect(rendererContract.peersAfter).toEqual(rendererContract.peersBefore);
		expect(rendererContract.afterCrossings).toBeLessThan(rendererContract.beforeCrossings);
		expect(rendererContract.topBiasedRankAligned).toBe(true);
		expect(rendererContract.routes).not.toHaveLength(0);
		expect(rendererContract.routes.every(({ fourPointLinePath }) => fourPointLinePath)).toBe(true);
		expect(rendererContract.routes.every(({ orthogonal }) => orthogonal)).toBe(true);
		expect(rendererContract.routes.every(({ endpointContact }) => endpointContact)).toBe(true);
	});
});
