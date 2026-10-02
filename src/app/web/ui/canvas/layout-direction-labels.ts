import { LayoutDirection } from '../../../../lib/core/document/logic-document';
import { m } from '../../i18n/paraglide/messages';

/** Where the root (the goal every arrow points at) sits on screen. */
export const layoutDirectionLabels: Readonly<Record<LayoutDirection, string>> = {
	get [LayoutDirection.TopToBottom]() {
		return m.canvas_direction_top();
	},
	get [LayoutDirection.BottomToTop]() {
		return m.canvas_direction_bottom();
	},
	get [LayoutDirection.LeftToRight]() {
		return m.canvas_direction_left();
	},
	get [LayoutDirection.RightToLeft]() {
		return m.canvas_direction_right();
	},
};
