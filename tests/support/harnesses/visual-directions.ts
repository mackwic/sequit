import { LayoutBias, LayoutDirection } from '../../../src/lib/core/document/logic-document';

const defaultBias = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};

export function defaultBiasFor(direction: LayoutDirection): LayoutBias {
	return defaultBias[direction];
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
