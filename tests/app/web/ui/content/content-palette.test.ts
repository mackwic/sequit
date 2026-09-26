import { describe, expect, it } from 'vitest';

import { contentPalette } from '../../../../../src/app/web/ui/content/content-palette';
import { styleDocumentNature } from '../../../../../src/lib/core/document/content-style';
import { validateLogicDocument } from '../../../../../src/lib/core/document/validate-logic-document';
import { validLogicDocument } from '../../../../support/builders/logic-document';

describe('content color palette', () => {
	it('offers uniquely named families of distinct colors accepted by document styles', () => {
		const labels = contentPalette.map(({ label }) => label);
		const colors = contentPalette.flatMap(({ colors: familyColors }) => [...familyColors]);
		const document = validLogicDocument();

		expect(new Set(labels).size).toBe(labels.length);
		for (const label of labels) expect(label.trim()).not.toBe('');
		expect(new Set(colors).size).toBe(colors.length);
		for (const color of colors) {
			const styled = styleDocumentNature(document, 'goal', { color });
			expect(validateLogicDocument(styled).ok).toBe(true);
		}
	});
});
