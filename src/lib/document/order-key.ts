const ORDER_KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ORDER_KEY_HEADS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const RESERVED_MINIMUM = `A${'0'.repeat(26)}`;

export type OrderKey = string;

export function parseOrderKey(value: string): OrderKey | undefined {
	if (value.length < 2 || value === RESERVED_MINIMUM) return undefined;

	const headIndex = ORDER_KEY_HEADS.indexOf(value.charAt(0));
	if (headIndex < 0) return undefined;
	const half = ORDER_KEY_HEADS.length / 2;
	let integerLength = headIndex - half + 2;
	if (headIndex < half) integerLength = half - headIndex + 1;
	if (value.length < integerLength) return undefined;

	for (let index = 1; index < value.length; index += 1) {
		if (!ORDER_KEY_DIGITS.includes(value.charAt(index))) return undefined;
	}
	if (value.length > integerLength && value.endsWith(ORDER_KEY_DIGITS.charAt(0))) return undefined;
	return value;
}

export function orderKey(value: string): OrderKey {
	const parsed = parseOrderKey(value);
	if (parsed === undefined) throw new Error(`Invalid fractional order key: ${value}`);
	return parsed;
}
