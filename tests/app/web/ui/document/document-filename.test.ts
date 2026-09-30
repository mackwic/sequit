import { describe, expect, it } from 'vitest';

import { documentFilename } from '../../../../../src/app/web/ui/document/document-filename';

describe('documentFilename', () => {
	it('slugs the title without accents or punctuation', () => {
		expect(documentFilename('Décision : réduire l’effort (v2) !', 'doc')).toBe(
			'decision-reduire-l-effort-v2.sequit.toml',
		);
	});

	it('falls back to the identifier when the title has no usable character', () => {
		expect(documentFilename('   ', 'ai-documentary-effort')).toBe(
			'ai-documentary-effort.sequit.toml',
		);
		expect(documentFilename('…', 'x')).toBe('x.sequit.toml');
	});
});
