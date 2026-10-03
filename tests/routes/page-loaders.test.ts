import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultNatures } from '../../src/lib/core/document/nature-families';
import { parseSequitToml } from '../../src/lib/infrastructure/toml/parse-sequit-toml';
import { load as loadHome } from '../../src/routes/+page.server';
import { load as loadCollaboration } from '../../src/routes/atelier/collaboration/+page';
import { load as loadAiDocumentaryEffort } from '../../src/routes/examples/ai-documentary-effort/+page';

describe('page loaders', () => {
	it('provides a fresh blank document for each home page request', async () => {
		const first: unknown = await Reflect.apply(loadHome, undefined, [{}]);
		const second: unknown = await Reflect.apply(loadHome, undefined, [{}]);
		if (first === null || typeof first !== 'object' || !('source' in first))
			throw new Error('Home loader returned no source');
		if (second === null || typeof second !== 'object' || !('source' in second))
			throw new Error('Home loader returned no source');
		if (typeof first.source !== 'string' || typeof second.source !== 'string')
			throw new Error('Home loader returned an invalid source');
		const parsed = parseSequitToml(first.source);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toMatchObject({
			title: 'Sans titre',
			nodes: [],
			groups: [],
			junctions: [],
			relations: [],
		});
		expect(parsed.value.natures.map((nature) => nature.id).sort()).toEqual(
			defaultNatures()
				.map((nature) => nature.id)
				.sort(),
		);
		expect(parsed.value.natures.every((nature) => nature.family === 'generic')).toBe(true);
		expect(second.source).not.toEqual(first.source);
	});

	it('provides the AI documentary effort example', async () => {
		const example: unknown = await Reflect.apply(loadAiDocumentaryEffort, undefined, [{}]);
		expect(example).toHaveProperty('source');
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
