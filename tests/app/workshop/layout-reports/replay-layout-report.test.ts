import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSharedCanvasProjection } from '../../../../src/app/web/projection/shared-canvas-projection';
import { captureLayoutReport } from '../../../../src/app/web/ui/report/capture-layout-report';
import {
	LayoutReplayKind,
	replayLayoutReport,
} from '../../../../src/app/workshop/layout-reports/replay-layout-report';
import {
	type LayoutReport,
	LayoutReportCategory,
} from '../../../../src/lib/infrastructure/layout-report/layout-report';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { validLayoutReport } from '../../../lib/infrastructure/layout-report/layout-report-fixture';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';

/** A report the page would send over the example document, laid out as it was shown. */
async function capturedReport(): Promise<LayoutReport> {
	const parsed = parseSequitToml(
		readFileSync(
			new URL('../../../../examples/ai-documentation.sequit.toml', import.meta.url),
			'utf8',
		),
	);
	if (!parsed.ok) throw new Error('The example document must parse');
	const document = parsed.value;
	const measurements = layoutMeasurementsFor(document);
	return captureLayoutReport({
		document,
		measurements,
		canvas: await createSharedCanvasProjection(document).createCanvasModel(measurements),
		zones: [],
		category: LayoutReportCategory.Crossing,
		comment: '',
		environment: {
			userAgent: 'test',
			language: 'fr',
			devicePixelRatio: 1,
			viewport: { width: 1, height: 1 },
		},
	});
}

describe('layout report replay', () => {
	it('reproduces the reported geometry from the stored document and measurements', async () => {
		const report = await capturedReport();
		const replay = await replayLayoutReport(report);
		expect(replay).toEqual({
			kind: LayoutReplayKind.Laid,
			layout: report.layout,
			reproduced: true,
		});
	});

	it('tells when the current engine computes another geometry', async () => {
		const report = validLayoutReport();
		const replay = await replayLayoutReport({
			...report,
			measurements: (await capturedReport()).measurements,
		});
		expect(replay).toMatchObject({ kind: LayoutReplayKind.Laid, reproduced: false });
	});

	it('names the failure and whether the report showed the same one', async () => {
		const report = await capturedReport();
		const unmeasured = { ...report, measurements: { nodes: [], junctions: [], groups: [] } };
		expect(
			await replayLayoutReport({ ...unmeasured, failure: 'missing-node-measurement' }),
		).toEqual({
			kind: LayoutReplayKind.Failed,
			failure: 'missing-node-measurement',
			reproduced: true,
		});
		expect(await replayLayoutReport(unmeasured)).toMatchObject({ reproduced: false });
	});

	it('refuses a document this version cannot read', async () => {
		const report = { ...validLayoutReport(), document: 'not = [toml' };
		expect(await replayLayoutReport(report)).toEqual({
			kind: LayoutReplayKind.InvalidDocument,
			reproduced: false,
		});
	});
});
