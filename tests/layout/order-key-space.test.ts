import { describe, expect, it } from 'vitest';

import { fractionalOrderKeySpace } from '../../src/lib/layout/order-key-space';

describe('fractionalOrderKeySpace', () => {
	it('uses a discriminator to avoid same-interval allocation collisions', () => {
		const unbounded = fractionalOrderKeySpace.keyFor({}, 'unbounded');
		expect(fractionalOrderKeySpace.isValid(unbounded)).toBe(true);
		const emptyDiscriminator = fractionalOrderKeySpace.keyFor({}, '');
		expect(fractionalOrderKeySpace.isValid(emptyDiscriminator)).toBe(true);
		expect(emptyDiscriminator).not.toBe(unbounded);
		const left = fractionalOrderKeySpace.keyFor({});
		const right = fractionalOrderKeySpace.keyFor({ before: left });
		const first = fractionalOrderKeySpace.keyFor({ before: left, after: right }, 'first');
		const second = fractionalOrderKeySpace.keyFor({ before: left, after: right }, 'second');

		expect(first).not.toBe(second);
		for (const key of [first, second]) {
			expect(fractionalOrderKeySpace.compare(left, key)).toBeLessThan(0);
			expect(fractionalOrderKeySpace.compare(key, right)).toBeLessThan(0);
		}
	});

	it('creates valid keys before, after, and between neighbors', () => {
		const middle = fractionalOrderKeySpace.keyFor({});
		const before = fractionalOrderKeySpace.keyFor({ after: middle });
		const after = fractionalOrderKeySpace.keyFor({ before: middle });
		expect(fractionalOrderKeySpace.isValid(before)).toBe(true);
		expect(fractionalOrderKeySpace.compare(before, middle)).toBeLessThan(0);
		expect(fractionalOrderKeySpace.compare(middle, after)).toBeLessThan(0);
	});

	it('supports repeated insertion into the same narrowing slot', () => {
		const before = fractionalOrderKeySpace.keyFor({});
		const after = fractionalOrderKeySpace.keyFor({ before });
		let upper = after;
		for (let index = 0; index < 100; index += 1) {
			const inserted = fractionalOrderKeySpace.keyFor({ before, after: upper });
			expect(fractionalOrderKeySpace.compare(before, inserted)).toBeLessThan(0);
			expect(fractionalOrderKeySpace.compare(inserted, upper)).toBeLessThan(0);
			upper = inserted;
		}
	});

	it('rejects malformed keys', () => {
		for (const malformed of [
			'',
			'a',
			'!0',
			'a!',
			'a0!',
			'a00',
			'A00000000000000000000000000',
			'Z',
			'a0é',
		]) {
			expect(fractionalOrderKeySpace.isValid(malformed), malformed).toBe(false);
		}
	});

	it('rejects malformed and reversed slot bounds', () => {
		expect(() => fractionalOrderKeySpace.keyFor({ before: 'invalid' })).toThrow(
			'Invalid order-key slot lower bound: invalid',
		);
		expect(() => fractionalOrderKeySpace.keyFor({ after: 'invalid' })).toThrow(
			'Invalid order-key slot upper bound: invalid',
		);
		const key = fractionalOrderKeySpace.keyFor({});
		expect(() => fractionalOrderKeySpace.keyFor({ before: key, after: key })).toThrow(
			'Order-key slot lower bound must be strictly less than upper bound',
		);
	});
});
