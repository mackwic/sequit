import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { LayoutMeasurements } from '../../../../../src/app/web/projection/layout-graph';
import { createSharedCanvasProjection } from '../../../../../src/app/web/projection/shared-canvas-projection';
import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import type { CanvasModel } from '../../../../../src/app/web/ui/canvas/canvas-model';
import {
	captureLayoutReport,
	type LayoutReportCapture,
} from '../../../../../src/app/web/ui/report/capture-layout-report';
import { anonymizeDocument } from '../../../../../src/lib/core/document/anonymize-document';
import type { LogicDocument } from '../../../../../src/lib/core/document/logic-document';
import {
	LayoutReportCategory,
	ReportedEntityKind,
} from '../../../../../src/lib/infrastructure/layout-report/layout-report';
import { parseLayoutReport } from '../../../../../src/lib/infrastructure/layout-report/parse-layout-report';
import { parseSequitToml } from '../../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { persistedNestedGridWithLaneCellDocument } from '../../../../lib/core/layout/nested-region-fixture';
import { layoutMeasurementsFor } from '../../../../support/builders/layout-measurements';

const ENVIRONMENT = {
	userAgent: 'test',
	language: 'fr',
	devicePixelRatio: 2,
	viewport: { width: 1280, height: 800 },
};

function exampleDocument(): LogicDocument {
	const source = readFileSync(
		new URL('../../../../../examples/ai-documentation.sequit.toml', import.meta.url),
		'utf8',
	);
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('The example document must parse');
	return parsed.value;
}

/** Sizes that differ per box, so that a renamed box laid out elsewhere would show. */
function variedMeasurements(document: LogicDocument): LayoutMeasurements {
	const sizes = Object.fromEntries(
		document.nodes.map(({ id }, index) => [
			id,
			{ width: 160 + (index % 5) * 30, height: 60 + (index % 3) * 24 },
		]),
	);
	return layoutMeasurementsFor(document, { nodes: sizes });
}

async function shownCanvas(
	document: LogicDocument,
	measurements: LayoutMeasurements,
): Promise<CanvasModel> {
	return createSharedCanvasProjection(document).createCanvasModel(measurements);
}

function capture(
	overrides: Partial<LayoutReportCapture> & Pick<LayoutReportCapture, 'document' | 'measurements'>,
): LayoutReportCapture {
	return {
		zones: [],
		category: LayoutReportCategory.Overlap,
		comment: '',
		environment: ENVIRONMENT,
		...overrides,
	};
}

describe('layout report capture', () => {
	it.each([
		['the example document', exampleDocument],
		['a grid of regions with a lane cell', persistedNestedGridWithLaneCellDocument],
	])('lays %s out identically once anonymized', async (_name, build) => {
		const document = build();
		const measurements = variedMeasurements(document);
		const canvas = await shownCanvas(document, measurements);
		const report = await captureLayoutReport(capture({ document, measurements, canvas }));
		expect(report.checks).toEqual({ anonymizationDiverged: false, projectionDiverged: false });
		expect(report.layout?.nodes).toHaveLength(canvas.nodes.length);
	});

	it('sends nothing original but the comment, in a form the server accepts', async () => {
		const document = exampleDocument();
		const measurements = variedMeasurements(document);
		const canvas = await shownCanvas(document, measurements);
		const onlyoffice = canvas.nodes.find(({ id }) => id === 'onlyoffice');
		if (onlyoffice === undefined) throw new Error('The example shows onlyoffice');
		const report = await captureLayoutReport(
			capture({
				document,
				measurements,
				canvas,
				zones: [
					{
						bounds: onlyoffice.bounds,
						entities: [{ kind: EntityKind.Node, id: 'onlyoffice' }],
					},
				],
				comment: 'La boîte chevauche sa voisine',
			}),
		);
		const sent = JSON.stringify(report);
		for (const original of [
			document.title,
			...document.nodes.flatMap(({ id, markdown }) => [`"${id}"`, markdown.trim()]),
			...document.groups.flatMap(({ id, label }) => [`"${id}"`, label]),
		])
			expect(sent).not.toContain(original);
		const token = anonymizeDocument(document).identifiers.get('onlyoffice');
		expect(report.zones).toEqual([
			{ bounds: onlyoffice.bounds, entities: [{ kind: ReportedEntityKind.Node, id: token }] },
		]);
		expect(report.layout?.nodes.find(({ id }) => id === token)?.bounds).toEqual(onlyoffice.bounds);
		expect(report.comment).toBe('La boîte chevauche sa voisine');
		expect(parseLayoutReport(JSON.parse(sent))).toEqual(report);
	});

	it('flags a shown canvas that differs from a cold layout of the same inputs', async () => {
		const document = exampleDocument();
		const measurements = variedMeasurements(document);
		const canvas = await shownCanvas(document, measurements);
		const [first, ...others] = canvas.nodes;
		if (first === undefined) throw new Error('The example shows nodes');
		const drifted = {
			...canvas,
			nodes: [{ ...first, bounds: { ...first.bounds, x: first.bounds.x + 40 } }, ...others],
		};
		const report = await captureLayoutReport(capture({ document, measurements, canvas: drifted }));
		expect(report.checks).toEqual({ anonymizationDiverged: false, projectionDiverged: true });
	});

	it('reports the failure shown instead of a canvas, without a layout', async () => {
		const document = exampleDocument();
		const report = await captureLayoutReport(
			capture({
				document,
				measurements: { nodes: new Map(), junctions: new Map(), groups: new Map() },
				failure: 'missing-node-measurement',
				category: LayoutReportCategory.Failure,
			}),
		);
		expect(report.failure).toBe('missing-node-measurement');
		expect(report.layout).toBeUndefined();
		expect(report.checks).toEqual({ anonymizationDiverged: false, projectionDiverged: false });
		expect(parseLayoutReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
	});
});
