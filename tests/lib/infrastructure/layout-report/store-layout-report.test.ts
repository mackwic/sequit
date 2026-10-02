import { describe, expect, it } from 'vitest';

import {
	type LayoutReportBucket,
	LayoutReportStoreOutcomeKind,
	storeLayoutReport,
} from '../../../../src/lib/infrastructure/layout-report/store-layout-report';
import { validLayoutReport } from './layout-report-fixture';

interface StoredObject {
	readonly key: string;
	readonly value: string;
	readonly options: Parameters<LayoutReportBucket['put']>[2];
}

function bucket(): LayoutReportBucket & { readonly objects: StoredObject[] } {
	const objects: StoredObject[] = [];
	return {
		objects,
		put(key, value, options) {
			objects.push({ key, value, options });
			return Promise.resolve();
		},
	};
}

const RECEPTION = {
	id: '6f1c',
	at: new Date('2026-10-02T13:45:00Z'),
	build: { id: 'version-1', tag: 'v1', timestamp: '2026-10-01T00:00:00Z' },
};

describe('layout report storage', () => {
	it('stores the rebuilt report under its day, with its reception and listing metadata', async () => {
		const target = bucket();
		const report = validLayoutReport();
		const outcome = await storeLayoutReport(
			target,
			JSON.stringify({ ...report, injected: true }),
			RECEPTION,
		);
		const key = 'layout-reports/2026-10-02/6f1c.json';
		expect(outcome).toEqual({ kind: LayoutReportStoreOutcomeKind.Stored, id: '6f1c', key });
		expect(target.objects).toHaveLength(1);
		const [stored] = target.objects;
		expect(stored?.key).toBe(key);
		expect(JSON.parse(stored?.value ?? '')).toEqual({
			id: '6f1c',
			receivedAt: '2026-10-02T13:45:00.000Z',
			build: RECEPTION.build,
			...report,
		});
		expect(stored?.options).toEqual({
			httpMetadata: { contentType: 'application/json' },
			customMetadata: {
				category: report.category,
				receivedAt: '2026-10-02T13:45:00.000Z',
				build: 'version-1',
			},
		});
	});

	it('stores without a build when the Worker version is unknown', async () => {
		const target = bucket();
		await storeLayoutReport(target, JSON.stringify(validLayoutReport()), {
			id: 'local',
			at: RECEPTION.at,
		});
		expect(JSON.parse(target.objects[0]?.value ?? '')).toMatchObject({ build: null });
		expect(target.objects[0]?.options.customMetadata).not.toHaveProperty('build');
	});

	it('refuses an oversized or malformed body without writing anything', async () => {
		const target = bucket();
		await expect(storeLayoutReport(target, 'x'.repeat(4_000_001), RECEPTION)).resolves.toEqual({
			kind: LayoutReportStoreOutcomeKind.TooLarge,
		});
		await expect(storeLayoutReport(target, '{"schemaVersion":', RECEPTION)).resolves.toEqual({
			kind: LayoutReportStoreOutcomeKind.Malformed,
		});
		await expect(storeLayoutReport(target, '{}', RECEPTION)).resolves.toEqual({
			kind: LayoutReportStoreOutcomeKind.Malformed,
		});
		expect(target.objects).toEqual([]);
	});
});
