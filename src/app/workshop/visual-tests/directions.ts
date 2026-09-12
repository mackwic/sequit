import {
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
} from '../../../lib/core/document/logic-document';

/** View preferences owned by the gallery, shared across its scenario screens. */
export interface VisualTestSettings {
	direction: LayoutDirection;
	bias: LayoutBias;
}

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

const defaultBias = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};

export function defaultBiasFor(direction: LayoutDirection): LayoutBias {
	return defaultBias[direction];
}

export function biasOptionsFor(direction: LayoutDirection): typeof biasOptions {
	return biasOptions.filter(({ value }) => layoutConfiguration(direction, value) !== undefined);
}

const axes = {
	[LayoutDirection.TopToBottom]: {
		transverse: 'x',
		primary: 'y',
		rowAlignment: 'centerY',
		chainAlignment: 'centerX',
	},
	[LayoutDirection.BottomToTop]: {
		transverse: 'x',
		primary: 'y',
		rowAlignment: 'centerY',
		chainAlignment: 'centerX',
	},
	[LayoutDirection.LeftToRight]: {
		transverse: 'y',
		primary: 'x',
		rowAlignment: 'centerX',
		chainAlignment: 'centerY',
	},
	[LayoutDirection.RightToLeft]: {
		transverse: 'y',
		primary: 'x',
		rowAlignment: 'centerX',
		chainAlignment: 'centerY',
	},
} as const;

export function axesFor(direction: LayoutDirection): (typeof axes)[LayoutDirection] {
	return axes[direction];
}
