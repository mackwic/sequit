import { m } from '../i18n/paraglide/messages';

/** Hints shown in the empty text fields of a box, in its dialog, local or shared, or in place. */
export const NODE_TEXT_PLACEHOLDERS = {
	get markdown() {
		return m.editor_node_markdown_placeholder();
	},
	get description() {
		return m.editor_node_description_placeholder();
	},
	/** A box typed in place shows it on one line, and is measured with it. */
	get inline() {
		return m.editor_node_inline_placeholder();
	},
} as const;
