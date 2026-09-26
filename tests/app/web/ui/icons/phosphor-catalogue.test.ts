import { describe, expect, it } from 'vitest';

import { iconUrl } from '../../../../../src/app/web/ui/icons/phosphor';
import { phosphorIcons } from '../../../../../src/app/web/ui/icons/phosphor-catalogue';

describe('Phosphor icon catalogue', () => {
	it('resolves unique bundled icons and leaves unsupported references for fallback rendering', () => {
		const ids = phosphorIcons.map(({ id }) => id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(iconUrl(id)).toBeDefined();

		for (const reference of [
			'none',
			'phosphor:missing-icon',
			'custom-library:customer-logo',
			'https://example.test/icon.svg',
		])
			expect(iconUrl(reference)).toBeUndefined();
	});
});
