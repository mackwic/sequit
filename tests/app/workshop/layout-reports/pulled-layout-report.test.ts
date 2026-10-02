import { describe, expect, it } from 'vitest';

import { parsePulledFiles } from '../../../../src/app/workshop/layout-reports/pulled-layout-report';
import { validLayoutReport } from '../../../lib/infrastructure/layout-report/layout-report-fixture';

const BUILD = { id: 'fb984ac6-0000', tag: 'v12', timestamp: '2026-10-02T14:00:00.000Z' };

function stored(id: string, receivedAt: string, build: unknown = BUILD): unknown {
	return { id, receivedAt, build, ...validLayoutReport() };
}

describe('pulled layout reports', () => {
	it('lists readable reports newest first and names the files it cannot read', () => {
		const pulled = parsePulledFiles({
			files: [
				{ path: '2026-10-01/a.json', content: stored('a', '2026-10-01T09:00:00.000Z') },
				{ path: '2026-10-02/b.json', content: stored('b', '2026-10-02T09:00:00.000Z', null) },
				{ path: '2026-10-02/broken.json' },
				{ path: '2026-10-02/foreign.json', content: { ...validLayoutReport(), id: 'c' } },
			],
		});
		expect(pulled?.reports.map(({ id, build }) => [id, build])).toEqual([
			['b', undefined],
			['a', BUILD],
		]);
		expect(pulled?.reports[1]?.report).toEqual(validLayoutReport());
		expect(pulled?.unreadable).toEqual(['2026-10-02/broken.json', '2026-10-02/foreign.json']);
	});

	it('refuses a report whose build is malformed rather than dropping it', () => {
		const content = stored('a', '2026-10-01T09:00:00.000Z', { id: 'x', tag: 3 });
		expect(parsePulledFiles({ files: [{ path: 'a.json', content }] })?.unreadable).toEqual([
			'a.json',
		]);
	});

	it.each([
		['no answer', undefined],
		['no file list', { files: {} }],
		['a file without a path', { files: [{ content: {} }] }],
	])('refuses %s', (_name, answer) => {
		expect(parsePulledFiles(answer)).toBeUndefined();
	});
});
