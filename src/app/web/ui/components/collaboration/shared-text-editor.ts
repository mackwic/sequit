import type Quill from 'quill';
import * as Y from 'yjs';

import type { CollaborativeDocumentSession } from '../../../../../lib/infrastructure/collaboration/collaborative-document-session-types';
import type { SharedTarget } from '../../../../../lib/infrastructure/document/shared-document-command';
import { bindQuillMarkdown, type QuillMarkdownEditor } from '../../../document/quill-editor';
import { quillEditorOptions, type QuillEditorProfile } from '../../../document/quill-editor-config';
import { describeQuillField } from '../../../document/quill-field';
import type { CollaborationAwareness } from './collaboration-awareness.svelte';

interface SharedTextOptions {
	readonly client: CollaborativeDocumentSession;
	readonly awareness: CollaborationAwareness;
	readonly target: SharedTarget;
	readonly field: string;
	/** The shared text the editor is bound to. */
	readonly text: Y.Text;
	readonly profile: QuillEditorProfile;
	/** Accessible name of the text box. */
	readonly label: string;
	readonly placeholder?: string | undefined;
	/** Whether the text can be typed right now. */
	readonly enabled: boolean;
}

interface SharedTextEditor {
	readonly quill: Quill;
	readonly editor: QuillMarkdownEditor;
	readonly destroy: () => void;
}

/**
 * Turns `host` into an editor bound live to a shared text: each keystroke is shared, peers' edits
 * arrive in place, and the caret is published to the other participants.
 */
export async function mountSharedText(
	host: HTMLElement,
	{
		client,
		awareness,
		target,
		field,
		text,
		profile,
		label,
		placeholder,
		enabled,
	}: SharedTextOptions,
): Promise<SharedTextEditor> {
	// Quill touches the DOM as it loads, so it is fetched in the browser, never during rendering.
	const { default: Editor } = await import('quill');
	const owner = Symbol('text editor');
	const quill = new Editor(
		host,
		quillEditorOptions(profile, {
			placeholder,
			showSource: () => {
				binding.editor.showSource();
			},
		}),
	);
	const undescribe = describeQuillField(quill, label);
	const binding = bindQuillMarkdown(
		quill,
		{
			text,
			edit: (markdown) => {
				client.updateText(target, field, markdown, text);
			},
			merge: (update) => {
				client.applyLocalTextUpdate(target, field, update, text);
			},
		},
		profile,
	);
	const protectSource = (event: KeyboardEvent): void => {
		const chord = event.ctrlKey || event.metaKey;
		if (!binding.editor.sourceMode || !chord) return;
		if (!['b', 'i', 'u'].includes(event.key.toLowerCase())) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	quill.root.addEventListener('keydown', protectSource, true);
	let destroyed = false;
	const publish = (): void => {
		if (destroyed) return;
		if (!quill.hasFocus()) {
			awareness.textSelection(owner, null);
			return;
		}
		awareness.textSelection(owner, {
			target,
			field,
			anchor: Y.encodeRelativePosition(
				Y.createRelativePositionFromTypeIndex(text, binding.editor.selectionStart),
			),
			head: Y.encodeRelativePosition(
				Y.createRelativePositionFromTypeIndex(text, binding.editor.selectionEnd),
			),
		});
	};
	const changed = (_name: string, ...args: unknown[]): void => {
		if (args.at(-1) !== 'silent') queueMicrotask(publish);
	};
	quill.on('editor-change', changed);
	const clear = (): void => {
		awareness.textSelection(owner, null);
	};
	quill.root.addEventListener('blur', clear);
	window.addEventListener('blur', clear);
	quill.history.clear();
	quill.enable(enabled);
	return {
		quill,
		editor: binding.editor,
		destroy: () => {
			destroyed = true;
			binding.destroy();
			quill.root.removeEventListener('keydown', protectSource, true);
			quill.off('editor-change', changed);
			quill.root.removeEventListener('blur', clear);
			window.removeEventListener('blur', clear);
			undescribe();
			clear();
		},
	};
}
