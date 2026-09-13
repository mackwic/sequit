import { afterEach, describe, expect, it, vi } from 'vitest';

import { load as loadHome } from '../../src/routes/+page';
import { load as loadCollaboration } from '../../src/routes/atelier/collaboration/+page';
import { load as loadAiDocumentaryEffort } from '../../src/routes/examples/ai-documentary-effort/+page';

describe('page loaders', () => {
	it('provides the home page example document', async () => {
		const result: unknown = await Reflect.apply(loadHome, undefined, [{}]);
		expect(result).toHaveProperty('source');
	});

	it('provides the AI documentary effort example', async () => {
		const example: unknown = await Reflect.apply(loadAiDocumentaryEffort, undefined, [{}]);
		const home: unknown = await Reflect.apply(loadHome, undefined, [{}]);
		expect(example).toEqual(home);
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
});
it('loads the known collaboration room in development only', () => {
	vi.stubEnv('DEV', true);
	const configured: unknown = Reflect.apply(loadCollaboration, undefined, [
		{ url: new URL('https://sequit.local/atelier/collaboration?room=room&name=Bob') },
	]);
	expect(configured).toEqual({ room: 'room', name: 'Bob' });
	const defaults: unknown = Reflect.apply(loadCollaboration, undefined, [
		{ url: new URL('https://sequit.local/atelier/collaboration') },
	]);
	expect(defaults).toEqual({ room: 'collaboration-test', name: 'Alice' });
	vi.stubEnv('DEV', false);
	expect(() => {
		Reflect.apply(loadCollaboration, undefined, [
			{ url: new URL('https://sequit.local/atelier/collaboration') },
		]);
	}).toThrow();
});
