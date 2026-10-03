import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSharedCanvasProjection } from '../../../../src/app/web/projection/shared-canvas-projection';
import { captureLayoutReport } from '../../../../src/app/web/ui/report/capture-layout-report';
import {
	LayoutReplayKind,
	replayLayoutReport,
	reportedGroups,
} from '../../../../src/app/workshop/layout-reports/replay-layout-report';
import { GroupState } from '../../../../src/lib/core/document/logic-document';
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

	it('names the failure, its causes, and whether the report showed the same one', async () => {
		const report = await capturedReport();
		const unmeasured = { ...report, measurements: { nodes: [], junctions: [], groups: [] } };
		const replay = await replayLayoutReport({ ...unmeasured, failure: 'missing-node-measurement' });
		expect(replay).toMatchObject({
			kind: LayoutReplayKind.Failed,
			failure: 'missing-node-measurement',
			reproduced: true,
			causes: [
				expect.stringMatching(/^LayoutProjectionError: Missing node measurement: e\d+$/),
				expect.stringMatching(/^Error: Missing node measurement: e\d+$/),
			],
		});
		if (replay.kind !== LayoutReplayKind.Failed) throw new Error('The replay must fail');
		expect(replay.stack?.startsWith(replay.causes.at(-1) ?? '')).toBe(true);
		expect(await replayLayoutReport(unmeasured)).toMatchObject({ reproduced: false });
	});

	it('replays the other side of a folding when the report measured the hidden boxes', async () => {
		const report = await capturedReport();
		const groups = reportedGroups(report);
		expect(groups.every(({ state }) => state !== GroupState.Closed)).toBe(true);
		const flipped = new Set(groups.map(({ id }) => id));
		const folded = await replayLayoutReport(report, flipped);
		if (folded.kind !== LayoutReplayKind.Laid) throw new Error('The folded replay must lay out');
		expect(folded.reproduced).toBe(false);
		expect(folded.layout.nodes.length).toBeLessThan(report.layout?.nodes.length ?? 0);

		const hidden = new Set(
			report.layout?.nodes
				.map(({ id }) => id)
				.filter((id) => !folded.layout.nodes.some((node) => node.id === id)),
		);
		const unmeasured = {
			...report,
			measurements: {
				...report.measurements,
				nodes: report.measurements.nodes.filter(([id]) => !hidden.has(id)),
			},
		};
		expect(await replayLayoutReport(unmeasured, flipped)).toMatchObject({
			kind: LayoutReplayKind.Laid,
		});
		expect(await replayLayoutReport(unmeasured)).toMatchObject({
			kind: LayoutReplayKind.Failed,
			failure: 'missing-node-measurement',
		});
	});

	it('refuses a document this version cannot read', async () => {
		const report = { ...validLayoutReport(), document: 'not = [toml' };
		expect(await replayLayoutReport(report)).toEqual({
			kind: LayoutReplayKind.InvalidDocument,
			reproduced: false,
		});
	});
});
