// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createSharedCanvasProjection } from '../../../../../src/app/web/projection/shared-canvas-projection';
import {
	browserEnvironment,
	captureLayoutReport,
	type LayoutReportCapture,
} from '../../../../../src/app/web/ui/report/capture-layout-report';
import {
	createRename,
	readRenderedLayout,
} from '../../../../../src/app/web/ui/report/report-geometry';
import { LayoutReportCategory } from '../../../../../src/lib/infrastructure/layout-report/layout-report';
import { layoutMeasurementsFor } from '../../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../../support/builders/logic-document';

function placed<T extends Element>(
	element: T,
	rect: { x: number; y: number; width: number; height: number },
): T {
	element.getBoundingClientRect = () => DOMRect.fromRect(rect);
	return element;
}

/** A stage drawn at zoom 2, 100 px from the viewport origin. */
function viewport(): HTMLElement {
	const root = document.createElement('div');
	const stage = placed(document.createElement('div'), { x: 100, y: 50, width: 800, height: 600 });
	stage.dataset['graphStage'] = '';
	stage.dataset['stageWidth'] = '400';
	stage.dataset['stageHeight'] = '300';
	const node = placed(document.createElement('button'), { x: 140, y: 90, width: 200, height: 120 });
	node.dataset['nodeId'] = 'secret-node';
	const unnamed = placed(document.createElement('button'), { x: 0, y: 0, width: 1, height: 1 });
	unnamed.dataset['nodeId'] = '';
	const group = placed(document.createElement('button'), {
		x: 100,
		y: 50,
		width: 400,
		height: 400,
	});
	group.dataset['groupId'] = 'secret-group';
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('data-rendered-relation-id', 'secret-route');
	path.setAttribute('d', 'M 10 20 L 10 80');
	svg.appendChild(path);
	for (const child of [node, unnamed, group, svg]) stage.appendChild(child);
	root.appendChild(stage);
	return root;
}

describe('rendered layout read-back', () => {
	it('brings drawn boxes back to canvas coordinates under anonymous identifiers', () => {
		const rename = createRename(new Map([['secret-node', 'e1']]));
		expect(readRenderedLayout(viewport(), rename)).toEqual({
			width: 400,
			height: 300,
			zoom: 2,
			nodes: [{ id: 'e1', bounds: { x: 20, y: 20, width: 100, height: 60 } }],
			groups: [{ id: 'x0', bounds: { x: 0, y: 0, width: 200, height: 200 } }],
			junctions: [],
			relations: [{ id: 'x1', path: 'M 10 20 L 10 80' }],
		});
	});

	it('reads nothing while no canvas is drawn', () => {
		const empty = document.createElement('div');
		expect(readRenderedLayout(empty, createRename(new Map()))).toBeUndefined();
		const collapsed = viewport();
		const stage = collapsed.querySelector('[data-graph-stage]');
		if (stage === null) throw new Error('Missing stage');
		placed(stage, { x: 0, y: 0, width: 0, height: 0 });
		expect(readRenderedLayout(collapsed, createRename(new Map()))).toBeUndefined();
	});

	it('sends what the page drew beside the shown canvas, and the browser it was drawn in', async () => {
		const source = validLogicDocument();
		const measurements = layoutMeasurementsFor(source);
		const capture: LayoutReportCapture = {
			document: source,
			measurements,
			canvas: await createSharedCanvasProjection(source).createCanvasModel(measurements),
			viewport: viewport(),
			zones: [],
			category: LayoutReportCategory.Other,
			comment: '',
			environment: browserEnvironment(),
		};
		const report = await captureLayoutReport(capture);
		expect(report.rendered?.zoom).toBe(2);
		expect(report.environment).toEqual({
			userAgent: navigator.userAgent,
			language: navigator.language,
			devicePixelRatio: window.devicePixelRatio,
			viewport: { width: window.innerWidth, height: window.innerHeight },
		});
		const undrawn = await captureLayoutReport({
			...capture,
			viewport: document.createElement('div'),
		});
		expect(undrawn.layout).toEqual(report.layout);
		expect(undrawn.rendered).toBeUndefined();
	});
});
