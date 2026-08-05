import { generateKeyBetween } from 'fractional-indexing';

import type { OrderKey } from '../document/logic-document';

export interface EndpointSlot {
	readonly before?: OrderKey;
	readonly after?: OrderKey;
}

export interface OrderKeySpace {
	compare(left: OrderKey, right: OrderKey): number;
	keyFor(slot: EndpointSlot, discriminator?: string): OrderKey;
	isValid(key: string): key is OrderKey;
}

function discriminatorBits(value: string): readonly number[] {
	const bits: number[] = [];
	for (const byte of new TextEncoder().encode(value)) {
		bits.push(1);
		for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1);
	}
	bits.push(0);
	return bits;
}

function generateDiscriminatedKey(
	before: OrderKey | undefined,
	after: OrderKey | undefined,
	discriminator: string,
): OrderKey {
	let lower = before;
	let upper = after;
	let candidate = generateKeyBetween(lower ?? null, upper ?? null);
	for (const bit of discriminatorBits(discriminator)) {
		if (bit === 0) upper = candidate;
		else lower = candidate;
		candidate = generateKeyBetween(lower ?? null, upper ?? null);
	}
	return candidate;
}

export const fractionalOrderKeySpace: OrderKeySpace = {
	compare: (left, right) => (left < right ? -1 : left > right ? 1 : 0),
	keyFor: ({ before, after }, discriminator) =>
		discriminator === undefined
			? generateKeyBetween(before ?? null, after ?? null)
			: generateDiscriminatedKey(before, after, discriminator),
	isValid: (key): key is OrderKey => {
		try {
			generateKeyBetween(key, null);
			return key.length > 0;
		} catch {
			return false;
		}
	},
};
