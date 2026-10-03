function hexChannels(color: string): readonly [number, number, number] | undefined {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
	let digits = match?.[1];
	if (digits === undefined) return undefined;
	if (digits.length === 3) digits = digits.replace(/./g, (digit) => digit.repeat(2));
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
}

function mixChannel(foreground: number, background: number, ratio: number): string {
	const inverse = 1 - ratio;
	const mixed = Math.round(foreground * ratio + background * inverse);
	return mixed.toString(16).padStart(2, '0');
}

/** The canvas uses the same sRGB mix for its colored border and header. */
export function mixedColor(color: string, background: string, ratio: number): string {
	const foreground = hexChannels(color);
	const base = hexChannels(background);
	if (foreground === undefined || base === undefined) return color;
	const [red, green, blue] = foreground;
	const [baseRed, baseGreen, baseBlue] = base;
	return `#${mixChannel(red, baseRed, ratio)}${mixChannel(green, baseGreen, ratio)}${mixChannel(blue, baseBlue, ratio)}`;
}
