import { generateKeyBetween } from 'fractional-indexing';

import { compareCanonicalStrings } from '../canonical-string';
import { type OrderKey, parseOrderKey } from '../document/order-key';

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

function assertSlot(slot: EndpointSlot): void {
	if (slot.before !== undefined && parseOrderKey(slot.before) === undefined)
		throw new Error(`Invalid order-key slot lower bound: ${slot.before}`);
	if (slot.after !== undefined && parseOrderKey(slot.after) === undefined)
		throw new Error(`Invalid order-key slot upper bound: ${slot.after}`);
	const hasBothBounds = slot.before !== undefined && slot.after !== undefined;
	const reversedBounds = hasBothBounds && compareCanonicalStrings(slot.before, slot.after) >= 0;
	if (reversedBounds)
		throw new Error('Order-key slot lower bound must be strictly less than upper bound');
}

export const fractionalOrderKeySpace: OrderKeySpace = {
	compare: compareCanonicalStrings,
	keyFor: (slot, discriminator) => {
		assertSlot(slot);
		if (discriminator !== undefined) {
			return generateDiscriminatedKey(slot.before, slot.after, discriminator);
		}
		return generateKeyBetween(slot.before ?? null, slot.after ?? null);
	},
	isValid: (key): key is OrderKey => parseOrderKey(key) !== undefined,
};
