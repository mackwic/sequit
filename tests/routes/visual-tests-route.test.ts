import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.resetModules();
	vi.unstubAllEnvs();
});

describe('visual test documentation route', () => {
	it('returns 404 in production without loading the documentation', async () => {
		vi.stubEnv('DEV', false);
		const { load } = await import('../../src/routes/atelier/tests-visuels/[[scenario]]/+page');
		expect(load).toThrow(expect.objectContaining({ status: 404 }));
	});
	it('is available during development without running a scenario', async () => {
		vi.stubEnv('DEV', true);
		const { load } = await import('../../src/routes/atelier/tests-visuels/[[scenario]]/+page');
		expect(load()).toEqual({});
	});
});

describe('solver prototype route', () => {
	it('is limited to development', async () => {
		vi.stubEnv('DEV', false);
		const { load } = await import('../../src/routes/atelier/solveur/+page');
		expect(load).toThrow(expect.objectContaining({ status: 404 }));
		vi.stubEnv('DEV', true);
		expect(load()).toEqual({});
	});
});
