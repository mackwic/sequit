import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../src/lib/canonical-string';
import { defined } from '../src/lib/document/logic-document';
import { orderKey } from '../src/lib/document/order-key';

describe('compareCanonicalStrings', () => {
	it('rejects an unexpectedly missing value', () => {
		expect(() => {
			defined(undefined, 'Missing test value');
		}).toThrow('Missing test value');
	});
	it('rejects an invalid asserted order key', () => {
		expect(() => orderKey('invalid key')).toThrow('Invalid fractional order key: invalid key');
	});
	it('uses exact JavaScript code-unit order', () => {
		const values = ['é', 'e\u0301', '\uE000', '😀', 'z', 'A'];
		expect([...values].sort(compareCanonicalStrings)).toEqual([
			'A',
			'e\u0301',
			'z',
			'é',
			'😀',
			'\uE000',
		]);
	});

	it('does not normalize canonically equivalent strings', () => {
		expect(compareCanonicalStrings('e\u0301', 'é')).toBeLessThan(0);
		expect(compareCanonicalStrings('exact', 'exact')).toBe(0);
		expect(compareCanonicalStrings('é', 'e\u0301')).toBeGreaterThan(0);
	});
});
