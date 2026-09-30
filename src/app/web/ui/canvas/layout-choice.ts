import {
	defined,
	LayoutBias,
	type LayoutConfiguration,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../lib/core/document/logic-document';

/**
 * The bias as the author reads it: the end of the main axis that slack boxes hug. Roots sit at
 * the origin of the direction, so the root side is the origin bias and survives direction changes.
 */
export enum LayoutSide {
	Root = 'root',
	Leaves = 'leaves',
}
export const LAYOUT_SIDES = Object.values(LayoutSide);

export const layoutSideLabels: Readonly<Record<LayoutSide, string>> = {
	[LayoutSide.Root]: 'Serrer vers le but',
	[LayoutSide.Leaves]: 'Aligner les points de départ',
};

/** The graph's arrows point at the root; the chip icon points the same way. */
export const layoutDirectionIcons: Readonly<Record<LayoutDirection, string>> = {
	[LayoutDirection.TopToBottom]: 'phosphor:arrow-up',
	[LayoutDirection.BottomToTop]: 'phosphor:arrow-down',
	[LayoutDirection.LeftToRight]: 'phosphor:arrow-left',
	[LayoutDirection.RightToLeft]: 'phosphor:arrow-right',
};

const ORIGIN_BIAS: Readonly<Record<LayoutDirection, LayoutBias>> = {
	[LayoutDirection.TopToBottom]: LayoutBias.Top,
	[LayoutDirection.BottomToTop]: LayoutBias.Bottom,
	[LayoutDirection.LeftToRight]: LayoutBias.Left,
	[LayoutDirection.RightToLeft]: LayoutBias.Right,
};
const END_BIAS: Readonly<Record<LayoutDirection, LayoutBias>> = {
	[LayoutDirection.TopToBottom]: LayoutBias.Bottom,
	[LayoutDirection.BottomToTop]: LayoutBias.Top,
	[LayoutDirection.LeftToRight]: LayoutBias.Right,
	[LayoutDirection.RightToLeft]: LayoutBias.Left,
};

export function layoutSide(layout: LayoutConfiguration): LayoutSide {
	if (layout.bias === ORIGIN_BIAS[layout.direction]) return LayoutSide.Root;
	return LayoutSide.Leaves;
}

export function layoutChoice(direction: LayoutDirection, side: LayoutSide): LayoutConfiguration {
	if (side === LayoutSide.Root)
		return defined(layoutConfiguration(direction, ORIGIN_BIAS[direction]));
	return defined(layoutConfiguration(direction, END_BIAS[direction]));
}
