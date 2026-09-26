import { describe, expect, it } from 'vitest';

import { contentPalette } from '../../../../../src/app/web/ui/content/content-palette';

describe('content color palette', () => {
	it('provides uniquely keyed families with valid, distinct shades', () => {
		const labels = contentPalette.map(({ label }) => label);
		const colors = contentPalette.flatMap(({ colors: familyColors }) => [...familyColors]);

		expect(new Set(labels).size).toBe(labels.length);
		expect(new Set(colors).size).toBe(colors.length);
		for (const family of contentPalette) {
			expect(family.label.trim()).not.toBe('');
			for (const color of family.colors) expect(color).toMatch(/^#[\da-f]{6}$/i);
		}
	});
});
