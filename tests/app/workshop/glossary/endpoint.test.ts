import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/app/workshop/glossary/storage', () => ({
	readDocument: vi.fn(() => Promise.resolve('Document')),
	saveDocument: vi.fn(() => Promise.resolve()),
}));
import { load } from '../../../../src/routes/atelier/lexique/+page';
import { GET, PUT } from '../../../../src/routes/atelier/lexique/data/+server';

async function put(body: unknown, origin = 'http://localhost'): Promise<unknown> {
	return await Reflect.apply(PUT, undefined, [
		{
			url: new URL('http://localhost/atelier/lexique/data'),
			request: new Request('http://localhost/atelier/lexique/data', {
				method: 'PUT',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify(body),
			}),
		},
	]);
}
afterEach(() => vi.unstubAllEnvs());
describe('local glossary endpoint', () => {
	it('reads and saves in development', async () => {
		vi.stubEnv('DEV', true);
		expect(load()).toEqual({});
		const response: unknown = await Reflect.apply(GET, undefined, [{}]);
		expect(response).toBeInstanceOf(Response);
		await expect(put({ base: 'Document', document: 'Edited' })).resolves.toBeInstanceOf(Response);
	});
	it('refuses cross-origin writes and malformed inputs', async () => {
		vi.stubEnv('DEV', true);
		await expect(put({}, 'http://elsewhere')).rejects.toMatchObject({ status: 403 });
		for (const body of [
			null,
			1,
			{},
			{ base: '' },
			{ base: 3, document: '' },
			{ base: '', document: 2 },
			{ base: '', document: 'x'.repeat(500_001) },
		]) {
			await expect(put(body)).rejects.toMatchObject({ status: 400 });
		}
	});
	it('is unavailable in production', async () => {
		vi.stubEnv('DEV', false);
		expect(() => load()).toThrow();
		await expect(Reflect.apply(GET, undefined, [{}])).rejects.toMatchObject({ status: 404 });
		await expect(put({})).rejects.toMatchObject({ status: 404 });
	});
});
