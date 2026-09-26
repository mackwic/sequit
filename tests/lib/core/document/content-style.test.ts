import { describe, expect, it } from 'vitest';

import { styleDocumentNature } from '../../../../src/lib/core/document/content-style';
import { validLogicDocument } from '../../../support/builders/logic-document';

describe('document content styles', () => {
	it('clears a nature icon override without changing the nature', () => {
		const document = validLogicDocument();
		const nature = document.natures[0];
		if (nature === undefined) throw new Error('Fixture nature missing');

		const withIcon = styleDocumentNature(document, nature.id, { icon: 'phosphor:scales' });
		expect(withIcon.natures[0]).toMatchObject({ icon: 'phosphor:scales' });

		const cleared = styleDocumentNature(withIcon, nature.id, {});
		expect(cleared.natures[0]).toEqual(nature);
	});
});
