import { describe, expect, it } from 'vitest';

import { load as loadHome } from '../../src/routes/+page';
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
