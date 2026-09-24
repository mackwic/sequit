import { expect, test } from '@playwright/test';
import type { Component } from 'svelte';
import * as Y from 'yjs';

import type { CanvasProjection } from '../../../../src/app/web/projection/canvas-projection';
import type { LayoutMeasurements } from '../../../../src/app/web/projection/layout-graph';
import type { CanvasSession } from '../../../../src/app/web/ui/session/canvas-session.svelte';
import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import {
	readSourceDocumentState,
	type SourceDocumentState,
	SourceDocumentStateKind,
} from '../../../../src/lib/infrastructure/collaboration/source-document-state';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	createYjsEntityMap,
	YjsCollection,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-schema';
import { validLogicDocument } from '../../../support/builders/logic-document';
import type {
	mount as svelteMount,
	unmount as svelteUnmount,
} from '../../../support/harnesses/browser-svelte-runtime';

test('success, current-document layout failure, then recovery replace the stabilized scene', async ({
	page,
}) => {
	await page.goto('/');
	const initial = validLogicDocument();
	const node = initial.nodes[0];
	if (!node) throw new Error('Expected a source node');
	const ungrouped = { ...node };
	delete ungrouped.groupId;
	const source: LogicDocument = {
		...initial,
		groups: [],
		nodes: [ungrouped],
		junctions: [],
		relations: [],
	};
	const ydoc = new Y.Doc();
	importLogicDocument(ydoc, { ...source, id: 'physical-current', title: 'Physical current' });
	const relations = ydoc.getMap<Y.Map<unknown>>(YjsCollection.Relations);
	relations.set(
		'physical-dangling-relation',
		createYjsEntityMap({ from: 'source-a', to: 'missing-physical-node' }),
	);
	const invalidSourceState = readSourceDocumentState(ydoc, 2);
	if (invalidSourceState.kind !== SourceDocumentStateKind.Invalid)
		throw new Error('Expected invalid physical source');
	relations.delete('physical-dangling-relation');
	const healedSourceState = readSourceDocumentState(ydoc, 3);
	if (healedSourceState.kind !== SourceDocumentStateKind.Valid)
		throw new Error('Expected healed physical source');
	ydoc.destroy();
	const observed = await page.evaluate(
		async ({ documentSource, invalidSourceState, healedSourceState }) => {
			function isProjectionModule(value: unknown): value is {
				createSharedCanvasProjection: (document: LogicDocument) => CanvasProjection & {
					update(document: LogicDocument): void;
					updateSourceState(state: SourceDocumentState): void;
				};
			} {
				return (
					typeof value === 'object' &&
					value !== null &&
					'createSharedCanvasProjection' in value &&
					typeof value.createSharedCanvasProjection === 'function'
				);
			}
			function isCanvasModule(
				value: unknown,
			): value is { default: Component<{ document: CanvasProjection; session: CanvasSession }> } {
				return (
					typeof value === 'object' &&
					value !== null &&
					'default' in value &&
					typeof value.default === 'function'
				);
			}
			function isSessionModule(
				value: unknown,
			): value is { CanvasSession: new () => CanvasSession } {
				return (
					typeof value === 'object' &&
					value !== null &&
					'CanvasSession' in value &&
					typeof value.CanvasSession === 'function'
				);
			}
			function isSvelteModule(
				value: unknown,
			): value is { mount: typeof svelteMount; unmount: typeof svelteUnmount } {
				return (
					typeof value === 'object' &&
					value !== null &&
					'mount' in value &&
					typeof value.mount === 'function' &&
					'unmount' in value &&
					typeof value.unmount === 'function'
				);
			}
			const importModule = (specifier: string): Promise<unknown> =>
				import(/* @vite-ignore */ specifier);
			const projectionModule = await importModule('/src/app/web/projection/open-document.ts');
			const canvasModule = await importModule(
				'/src/app/web/ui/components/canvas/LogicCanvas.svelte',
			);
			const sessionModule = await importModule('/src/app/web/ui/session/canvas-session.svelte.ts');
			const svelteModule = await importModule('/tests/support/harnesses/browser-svelte-runtime.ts');
			if (!isProjectionModule(projectionModule)) throw new Error('Invalid projection module');
			if (!isCanvasModule(canvasModule)) throw new Error('Invalid canvas module');
			if (!isSessionModule(sessionModule)) throw new Error('Invalid session module');
			if (!isSvelteModule(svelteModule)) throw new Error('Invalid Svelte module');
			const { createSharedCanvasProjection } = projectionModule;
			const { default: LogicCanvas } = canvasModule;
			const { CanvasSession } = sessionModule;
			const { mount, unmount } = svelteModule;
			const host = document.createElement('div');
			document.body.appendChild(host);
			const projection = createSharedCanvasProjection(documentSource);
			let injectFailure = false;
			const current: CanvasProjection = {
				get measurementModel() {
					return projection.measurementModel;
				},
				subscribe: (subscriber) => projection.subscribe(subscriber),
				createCanvasModel(measurements: LayoutMeasurements) {
					if (!injectFailure) return projection.createCanvasModel(measurements);
					const incomplete = {
						...measurements,
						nodes: new Map(measurements.nodes),
					};
					incomplete.nodes.delete('source-a');
					return projection.createCanvasModel(incomplete);
				},
			};
			const component = mount(LogicCanvas, {
				target: host,
				props: { document: current, session: new CanvasSession() },
			});
			async function until(selector: string): Promise<void> {
				const deadline = performance.now() + 5_000;
				while (host.querySelector(selector) === null) {
					if (performance.now() > deadline) throw new Error(`Timed out waiting for ${selector}`);
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
			}
			await until('[data-node-id="source-a"]');
			const first = host.querySelector('[data-graph-stage]') !== null;
			injectFailure = true;
			projection.update({
				...documentSource,
				id: 'current-document',
				title: 'Current title',
				nodes: documentSource.nodes.map((node) => ({
					...node,
					markdown: 'Current source',
				})),
			});
			await until('[data-layout-diagnostic]');
			const failed = {
				noStage: host.querySelector('[data-graph-stage]') === null,
				noOverlay: host.querySelector('[data-canvas-overlay]') === null,
				reasonCode: host.querySelector('[data-layout-reason]')?.getAttribute('data-layout-reason'),
				documentId: host.querySelector('[data-document-id]')?.getAttribute('data-document-id'),
				text: host.querySelector('[data-layout-diagnostic]')?.textContent,
			};
			injectFailure = false;
			projection.update({
				...documentSource,
				id: 'recovered-document',
				title: 'Recovered title',
				nodes: documentSource.nodes.map((node) => ({
					...node,
					markdown: 'Recovered source',
				})),
			});
			await until('[data-node-id="source-a"]');
			const recovered = {
				hasStage: host.querySelector('[data-graph-stage]') !== null,
				noDiagnostic: host.querySelector('[data-layout-diagnostic]') === null,
			};
			projection.updateSourceState(invalidSourceState);
			await until('[data-source-diagnostic]');
			const sourceInvalid = {
				noStage: host.querySelector('[data-graph-stage]') === null,
				noOverlay: host.querySelector('[data-canvas-overlay]') === null,
				documentId: host
					.querySelector('[data-source-diagnostic] [data-document-id]')
					?.getAttribute('data-document-id'),
				diagnosticCode: host
					.querySelector('[data-source-diagnostic-code]')
					?.getAttribute('data-source-diagnostic-code'),
				text: host.querySelector('[data-source-diagnostic]')?.textContent,
			};
			projection.updateSourceState(healedSourceState);
			await until('[data-node-id="source-a"]');
			const sourceHealed = {
				hasStage: host.querySelector('[data-graph-stage]') !== null,
				noDiagnostic: host.querySelector('[data-source-diagnostic]') === null,
			};
			await unmount(component);
			host.remove();
			return { first, failed, recovered, sourceInvalid, sourceHealed };
		},
		{ documentSource: source, invalidSourceState, healedSourceState },
	);

	expect(observed.first).toBe(true);
	expect(observed.failed).toMatchObject({
		noStage: true,
		noOverlay: true,
		reasonCode: 'missing-node-measurement',
		documentId: 'current-document',
	});
	expect(observed.failed.text).toContain('Mesure manquante pour le nœud « source-a ».');
	expect(observed.failed.text).toContain('Current title');
	expect(observed.failed.text).toContain('source-a');
	expect(observed.recovered).toEqual({ hasStage: true, noDiagnostic: true });
	expect(observed.sourceInvalid).toMatchObject({
		noStage: true,
		noOverlay: true,
		documentId: 'physical-current',
		diagnosticCode: 'invalid-yjs-live-document',
	});
	expect(observed.sourceInvalid.text).toContain('Physical current');
	expect(observed.sourceInvalid.text).toContain('physical-dangling-relation');
	expect(observed.sourceInvalid.text).not.toContain('missing-physical-node');
	expect(observed.sourceHealed).toEqual({ hasStage: true, noDiagnostic: true });
});
