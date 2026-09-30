import { LayoutDirection } from '../../../../lib/core/document/logic-document';

export const layoutDirectionLabels: Readonly<Record<LayoutDirection, string>> = {
	[LayoutDirection.TopToBottom]: 'De haut en bas',
	[LayoutDirection.BottomToTop]: 'De bas en haut',
	[LayoutDirection.LeftToRight]: 'De gauche à droite',
	[LayoutDirection.RightToLeft]: 'De droite à gauche',
};
