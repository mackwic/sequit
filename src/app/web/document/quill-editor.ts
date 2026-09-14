import { marked } from 'marked';
import type Quill from 'quill';

import { quillMarkdown, quillPlainText, translateTextIndex } from './quill-markdown';
import {
	sharedTextarea,
	type SharedTextareaElement,
	type SharedTextareaOptions,
} from './shared-textarea';

/** Adapt Quill to the Markdown binding, including its relative selection and IME handling. */
export class QuillMarkdownEditor extends EventTarget implements SharedTextareaElement {
	#markdown = '';
	selectionDirection: SharedTextareaElement['selectionDirection'] = 'forward';

	constructor(readonly quill: Quill) {
		super();
	}

	get value(): string {
		this.#markdown = quillMarkdown(this.quill.getContents());
		return this.#markdown;
	}

	set value(markdown: string) {
		this.#markdown = markdown;
		const html = marked.parse(markdown, { async: false, breaks: true });
		const next = this.quill.clipboard.convert({ html });
		// Every Quill document ends in a newline, including an empty document.
		if (!quillPlainText(next).endsWith('\n')) next.insert('\n');
		this.quill.updateContents(this.quill.getContents().diff(next), 'api');
	}

	toMarkdown(index: number): number {
		return translateTextIndex(quillPlainText(this.quill.getContents()), this.#markdown, index);
	}

	toEditor(index: number): number {
		return Math.min(
			this.quill.getLength() - 1,
			translateTextIndex(this.#markdown, quillPlainText(this.quill.getContents()), index),
		);
	}

	get selectionStart(): number {
		return this.toMarkdown(this.quill.getSelection()?.index ?? 0);
	}
	get selectionEnd(): number {
		const selection = this.quill.getSelection();
		if (selection === null) return 0;
		return this.toMarkdown(selection.index + selection.length);
	}

	setSelectionRange(start: number, end: number): void {
		if (!this.quill.hasFocus()) return;
		const index = this.toEditor(start);
		this.quill.setSelection(index, Math.max(0, this.toEditor(end) - index), 'silent');
	}
}

export function bindQuillMarkdown(
	quill: Quill,
	options: SharedTextareaOptions,
): {
	readonly editor: QuillMarkdownEditor;
	destroy(): void;
} {
	const editor = new QuillMarkdownEditor(quill);
	const binding = sharedTextarea(editor, options);
	const change = (_delta: unknown, _old: unknown, source: string): void => {
		if (source === 'user') editor.dispatchEvent(new Event('input'));
	};
	const start = (): void => {
		editor.dispatchEvent(new Event('compositionstart'));
	};
	let destroyed = false;
	const end = (): void => {
		queueMicrotask(() => {
			if (!destroyed) editor.dispatchEvent(new Event('compositionend'));
		});
	};
	quill.on('text-change', change);
	quill.root.addEventListener('compositionstart', start);
	quill.root.addEventListener('compositionend', end);
	return {
		editor,
		destroy(): void {
			quill.off('text-change', change);
			quill.root.removeEventListener('compositionstart', start);
			quill.root.removeEventListener('compositionend', end);
			destroyed = true;
			binding.destroy();
		},
	};
}
