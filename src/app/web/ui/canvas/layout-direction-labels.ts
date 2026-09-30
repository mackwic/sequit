import { LayoutDirection } from '../../../../lib/core/document/logic-document';

/** Where the root (the goal every arrow points at) sits on screen. */
export const layoutDirectionLabels: Readonly<Record<LayoutDirection, string>> = {
	[LayoutDirection.TopToBottom]: 'But en haut',
	[LayoutDirection.BottomToTop]: 'But en bas',
	[LayoutDirection.LeftToRight]: 'But à gauche',
	[LayoutDirection.RightToLeft]: 'But à droite',
};
