import { LayoutDirection } from '../../../../lib/core/document/logic-document';

/** A side of a box, named as Floating UI names its placements. */
export enum HandleSide {
	Top = 'top',
	Right = 'right',
	Bottom = 'bottom',
	Left = 'left',
}

/** Where the « + » handles of the selected box sit. */
export interface HandleSides {
	/** Away from the goal, where the layout puts children. */
	readonly child: HandleSide;
	/** Across the flow, where siblings line up beside the box. */
	readonly sibling: HandleSide;
}

const SIDES: Readonly<Record<LayoutDirection, HandleSides>> = {
	[LayoutDirection.TopToBottom]: { child: HandleSide.Bottom, sibling: HandleSide.Right },
	[LayoutDirection.BottomToTop]: { child: HandleSide.Top, sibling: HandleSide.Right },
	[LayoutDirection.LeftToRight]: { child: HandleSide.Right, sibling: HandleSide.Bottom },
	[LayoutDirection.RightToLeft]: { child: HandleSide.Left, sibling: HandleSide.Bottom },
};

/** The direction names where the goal sits; children grow on the opposite side. */
export function handleSides(direction: LayoutDirection): HandleSides {
	return SIDES[direction];
}
