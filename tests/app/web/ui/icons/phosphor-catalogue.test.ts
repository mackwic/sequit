import { describe, expect, it } from 'vitest';

import { isIconAvailable, loadIconUrl } from '../../../../../src/app/web/ui/icons/phosphor';
import { phosphorIcons } from '../../../../../src/app/web/ui/icons/phosphor-catalogue';

describe('Phosphor icon catalogue', () => {
	it('resolves unique bundled icons and leaves unsupported references for fallback rendering', async () => {
		const ids = phosphorIcons.map(({ id }) => id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(isIconAvailable(id)).toBe(true);
		expect(await loadIconUrl('phosphor:target')).toMatch(/target\.svg/);

		for (const reference of [
			'none',
			'phosphor:missing-icon',
			'custom-library:customer-logo',
			'https://example.test/icon.svg',
		]) {
			expect(isIconAvailable(reference)).toBe(false);
			expect(await loadIconUrl(reference)).toBeUndefined();
		}
	});
});
