import { describe, expect, it } from 'vitest';

import { iconUrl } from '../../../../../src/app/web/ui/icons/phosphor';
import { phosphorIcons } from '../../../../../src/app/web/ui/icons/phosphor-catalogue';

describe('Phosphor icon catalogue', () => {
	it('offers unique icon keys that resolve to bundled assets', () => {
		const ids = phosphorIcons.map(({ id }) => id);
		expect(new Set(ids).size).toBe(ids.length);

		const suggestedTarget = phosphorIcons.find(({ id }) => id === 'phosphor:target');
		expect(suggestedTarget).toMatchObject({ id: 'phosphor:target', label: 'target' });
		expect(suggestedTarget?.search).toContain('target');

		for (const { id } of phosphorIcons) expect(iconUrl(id)).toBeDefined();
	});

	it('leaves absent, custom, and external icon references unresolved for fallback rendering', () => {
		for (const reference of [
			'none',
			'phosphor:not-a-real-icon',
			'custom-library:customer-logo',
			'https://example.test/icon.svg',
		])
			expect(iconUrl(reference)).toBeUndefined();
	});
});
