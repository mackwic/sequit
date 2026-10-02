import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/app/workshop/layout-reports/storage', () => ({
	readPulledFiles: vi.fn(() => Promise.resolve([{ path: 'a.json', content: { id: 'a' } }])),
}));
import { load } from '../../../../src/routes/atelier/reports/+page';
import { GET } from '../../../../src/routes/atelier/reports/data/+server';

afterEach(() => vi.unstubAllEnvs());

describe('local layout reports endpoint', () => {
	it('lists the pulled files in development', async () => {
		vi.stubEnv('DEV', true);
		expect(load()).toEqual({});
		const response: unknown = await Reflect.apply(GET, undefined, [{}]);
		if (!(response instanceof Response)) throw new Error('Expected a response');
		expect(await response.json()).toEqual({ files: [{ path: 'a.json', content: { id: 'a' } }] });
	});

	it('is unavailable in production', async () => {
		vi.stubEnv('DEV', false);
		expect(() => load()).toThrow();
		await expect(Reflect.apply(GET, undefined, [{}])).rejects.toMatchObject({ status: 404 });
	});
});
