import { m } from '../i18n/paraglide/messages';

/** Hints shown in the empty text fields of the box dialog, local or shared. */
export const NODE_TEXT_PLACEHOLDERS = {
	get markdown() {
		return m.editor_node_markdown_placeholder();
	},
	get description() {
		return m.editor_node_description_placeholder();
	},
} as const;
