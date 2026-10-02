import { describe, expect, it } from 'vitest';

import { POST } from '../../src/routes/layout-reports/+server';
import { validLayoutReport } from '../lib/infrastructure/layout-report/layout-report-fixture';

function post(
	body: string,
	platform: unknown,
	headers: Record<string, string> = {},
): Promise<Response> {
	const request = new Request('https://sequit.test/layout-reports', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body,
	});
	return Promise.resolve(Reflect.apply(POST, undefined, [{ request, platform }]));
}

function platform(): {
	env: { LAYOUT_REPORTS: { put: (key: string) => Promise<void> } };
	keys: string[];
} {
	const keys: string[] = [];
	return {
		keys,
		env: {
			LAYOUT_REPORTS: {
				put: (key: string) => {
					keys.push(key);
					return Promise.resolve();
				},
			},
		},
	};
}

describe('POST /layout-reports', () => {
	it('stores a valid report and answers with its identifier', async () => {
		const target = platform();
		const response = await post(JSON.stringify(validLayoutReport()), target);
		expect(response.status).toBe(201);
		const body: unknown = await response.json();
		expect(body).toEqual({ id: expect.any(String) as unknown });
		expect(target.keys).toHaveLength(1);
		expect(target.keys[0]).toMatch(/^layout-reports\/\d{4}-\d{2}-\d{2}\/[\da-f-]{36}\.json$/);
	});

	it('refuses malformed and oversized bodies, and answers 503 without storage', async () => {
		const target = platform();
		expect((await post('{}', target)).status).toBe(400);
		expect((await post('{}', target, { 'content-length': '5000000' })).status).toBe(413);
		expect((await post(JSON.stringify(validLayoutReport()), undefined)).status).toBe(503);
		expect(target.keys).toEqual([]);
	});
});
