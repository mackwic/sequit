import { describe, expect, it } from 'vitest';

import {
	documentFilename,
	documentFileStem,
} from '../../../../../src/app/web/ui/document/document-filename';

describe('documentFileStem', () => {
	it('slugs the title without accents or punctuation', () => {
		expect(documentFileStem('Décision : réduire l’effort (v2) !', 'doc')).toBe(
			'decision-reduire-l-effort-v2',
		);
	});

	it('falls back to the identifier when the title has no usable character', () => {
		expect(documentFileStem('   ', 'ai-documentary-effort')).toBe('ai-documentary-effort');
		expect(documentFileStem('…', 'x')).toBe('x');
	});
});

describe('documentFilename', () => {
	it('appends the Sequit extension to the stem', () => {
		expect(documentFilename('Devis · lanes', 'doc')).toBe('devis-lanes.sequit.toml');
		expect(documentFilename('', 'doc')).toBe('doc.sequit.toml');
	});
});
