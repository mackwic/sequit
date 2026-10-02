import { describe, expect, it } from 'vitest';

import {
	LAYOUT_REPORT_ENDPOINT,
	submitLayoutReport,
} from '../../../../../src/app/web/ui/report/submit-layout-report';
import {
	LAYOUT_REPORT_SCHEMA,
	type LayoutReport,
	LayoutReportCategory,
} from '../../../../../src/lib/infrastructure/layout-report/layout-report';

const REPORT: LayoutReport = {
	schemaVersion: LAYOUT_REPORT_SCHEMA,
	category: LayoutReportCategory.Other,
	comment: '',
	document: '',
	measurements: { nodes: [], junctions: [], groups: [] },
	zones: [],
	checks: { anonymizationDiverged: false, projectionDiverged: false },
	environment: {
		userAgent: '',
		language: 'fr',
		devicePixelRatio: 1,
		viewport: { width: 1, height: 1 },
	},
};

function answering(response: Response): { send: typeof fetch; requests: Request[] } {
	const requests: Request[] = [];
	const send: typeof fetch = (input, init) => {
		if (typeof input !== 'string') throw new Error('The report goes to a path');
		requests.push(new Request(new URL(input, 'https://sequit.test'), init));
		return Promise.resolve(response);
	};
	return { send, requests };
}

describe('layout report submission', () => {
	it('posts the report as JSON and returns the identifier it was stored under', async () => {
		const { send, requests } = answering(Response.json({ id: 'stored' }, { status: 201 }));
		await expect(submitLayoutReport(REPORT, send)).resolves.toEqual({ ok: true, id: 'stored' });
		const [request] = requests;
		expect(request?.method).toBe('POST');
		expect(new URL(request?.url ?? '').pathname).toBe(LAYOUT_REPORT_ENDPOINT);
		await expect(request?.json()).resolves.toEqual(REPORT);
	});

	it('reports the refusing status, or 0 when the server is unreachable', async () => {
		const refused = answering(Response.json({ error: 'malformed' }, { status: 400 }));
		await expect(submitLayoutReport(REPORT, refused.send)).resolves.toEqual({
			ok: false,
			status: 400,
		});
		const silent = answering(new Response('stored', { status: 201 }));
		await expect(submitLayoutReport(REPORT, silent.send)).resolves.toEqual({
			ok: false,
			status: 201,
		});
		const offline: typeof fetch = () => Promise.reject(new TypeError('offline'));
		await expect(submitLayoutReport(REPORT, offline)).resolves.toEqual({ ok: false, status: 0 });
	});
});
