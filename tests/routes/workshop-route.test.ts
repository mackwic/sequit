import { isHttpError } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.resetModules();
	vi.unstubAllEnvs();
});

describe('development workshop route', () => {
	it('returns 404 in production without loading the workshop', async () => {
		vi.stubEnv('DEV', false);
		const { load } = await import('../../src/routes/atelier/+page');
		const result = Promise.resolve(load({ url: new URL('https://sequit.test/atelier') }));
		await expect(result).rejects.toSatisfy((error: unknown) => isHttpError(error, 404));
	});
	it('loads the requested fixture during development', async () => {
		vi.stubEnv('DEV', true);
		const { load } = await import('../../src/routes/atelier/+page');
		const result = await load({
			url: new URL('https://sequit.test/atelier?fixture=parcours'),
		});
		expect(result).toEqual({ fixture: null });
	});
});
