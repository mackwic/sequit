import {
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../lib/core/document/logic-document';

/** View preferences owned by the gallery, shared across its scenario screens. */
export interface VisualTestSettings {
	direction: LayoutDirection;
	bias: LayoutBias;
	guides: boolean;
	reservations: boolean;
}

export const defaultVisualTestSettings: VisualTestSettings = {
	direction: LayoutDirection.TopToBottom,
	bias: LayoutBias.Top,
	guides: true,
	reservations: false,
};

export const directionOptions = [
	{ value: LayoutDirection.TopToBottom, label: 'Top to bottom' },
	{ value: LayoutDirection.BottomToTop, label: 'Bottom to top' },
	{ value: LayoutDirection.LeftToRight, label: 'Left to right' },
	{ value: LayoutDirection.RightToLeft, label: 'Right to left' },
];

const biasOptions = [
	{ value: LayoutBias.Top, label: 'Top' },
	{ value: LayoutBias.Bottom, label: 'Bottom' },
	{ value: LayoutBias.Left, label: 'Left' },
	{ value: LayoutBias.Right, label: 'Right' },
];

export function biasOptionsFor(direction: LayoutDirection): typeof biasOptions {
	return biasOptions.filter(({ value }) => layoutConfiguration(direction, value) !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function parseVisualTestSettings(value: string | null): VisualTestSettings {
	if (value === null) return defaultVisualTestSettings;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed)) return defaultVisualTestSettings;
		const direction = directionOptions.find(({ value }) => value === parsed['direction'])?.value;
		const bias = biasOptions.find(({ value }) => value === parsed['bias'])?.value;
		if (
			direction === undefined ||
			bias === undefined ||
			typeof parsed['guides'] !== 'boolean' ||
			layoutConfiguration(direction, bias) === undefined
		) {
			return defaultVisualTestSettings;
		}
		return {
			direction,
			bias,
			guides: parsed['guides'],
			reservations: parsed['reservations'] === true,
		};
	} catch {
		return defaultVisualTestSettings;
	}
}
