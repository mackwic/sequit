import { marked } from 'marked';
import type Quill from 'quill';
import Delta from 'quill-delta';

import { QuillEditorProfile } from './quill-editor-config';
import { quillMarkdown, quillPlainText, translateTextIndex } from './quill-markdown';
import {
	sharedTextarea,
	type SharedTextareaElement,
	type SharedTextareaOptions,
} from './shared-textarea';

/** Adapt Quill to the Markdown binding, including its relative selection and IME handling. */
export class QuillMarkdownEditor extends EventTarget implements SharedTextareaElement {
	#markdown = '';
	#sourceMode: boolean;
	selectionDirection: SharedTextareaElement['selectionDirection'] = 'forward';

	constructor(
		readonly quill: Quill,
		profile = QuillEditorProfile.Description,
	) {
		super();
		this.#sourceMode = profile === QuillEditorProfile.Plain;
	}

	get sourceMode(): boolean {
		return this.#sourceMode;
	}

	get value(): string {
		if (this.#sourceMode) this.#markdown = this.quill.getText().slice(0, -1);
		else this.#markdown = quillMarkdown(this.quill.getContents());
		return this.#markdown;
	}

	set value(markdown: string) {
		this.#markdown = markdown;
		const next = this.contents(markdown);
		this.quill.updateContents(this.quill.getContents().diff(next), 'api');
	}

	/** Keep unsupported source intact, including when a peer introduces it during editing. */
	private contents(markdown: string): Delta {
		if (this.#sourceMode) return new Delta().insert(`${markdown}\n`);
		const html = marked.parse(markdown, { async: false, breaks: true });
		const next = this.quill.clipboard.convert({ html });
		// Every Quill document ends in a newline, including an empty document.
		if (!quillPlainText(next).endsWith('\n')) next.insert('\n');
		const roundtrip = marked.parse(quillMarkdown(next), { async: false, breaks: true });
		if (normalizedHtml(html) === normalizedHtml(roundtrip)) return next;
		this.#sourceMode = true;
		this.dispatchEvent(new Event('modechange'));
		return new Delta().insert(`${markdown}\n`);
	}

	showSource(): void {
		if (this.#sourceMode) return;
		const start = this.selectionStart;
		const end = this.selectionEnd;
		this.#sourceMode = true;
		this.value = this.#markdown;
		this.setSelectionRange(start, end);
		this.dispatchEvent(new Event('modechange'));
	}

	toMarkdown(index: number): number {
		if (this.#sourceMode) return Math.min(index, this.#markdown.length);
		return translateTextIndex(quillPlainText(this.quill.getContents()), this.#markdown, index);
	}

	toEditor(index: number): number {
		if (this.#sourceMode) return Math.min(index, this.quill.getLength() - 1);
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

function normalizedHtml(html: string): string {
	return new DOMParser().parseFromString(html, 'text/html').body.innerHTML.trim();
}

export function bindQuillMarkdown(
	quill: Quill,
	options: SharedTextareaOptions,
	profile = QuillEditorProfile.Description,
): {
	readonly editor: QuillMarkdownEditor;
	destroy(): void;
} {
	const editor = new QuillMarkdownEditor(quill, profile);
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
