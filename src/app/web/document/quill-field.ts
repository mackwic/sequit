import type Quill from 'quill';

import { m } from '../i18n/paraglide/messages';

const CONTROL_LABELS: Readonly<Record<string, string>> = {
	get bold() {
		return m.editor_bold();
	},
	get italic() {
		return m.editor_italic();
	},
	get underline() {
		return m.editor_underline();
	},
	get strike() {
		return m.editor_strike();
	},
	get code() {
		return m.editor_code();
	},
	get blockquote() {
		return m.editor_blockquote();
	},
	get 'code-block'() {
		return m.editor_code_block();
	},
	get link() {
		return m.editor_link();
	},
	get clean() {
		return m.editor_clean();
	},
	get source() {
		return m.editor_source();
	},
};
const LIST_LABELS: Readonly<Record<string, string>> = {
	get ordered() {
		return m.editor_ordered_list();
	},
	get bullet() {
		return m.editor_bullet_list();
	},
};
const HEADER_LABELS: Readonly<Record<string, string>> = {
	get '1'() {
		return m.editor_heading_1();
	},
	get '2'() {
		return m.editor_heading_2();
	},
	get '3'() {
		return m.editor_heading_3();
	},
};

/** The toolbar's focusable controls, in reading order. */
function toolbarStops(toolbar: HTMLElement): HTMLElement[] {
	return [...toolbar.querySelectorAll<HTMLElement>('button, .ql-picker-label')];
}

/** Only `current` stays reachable by Tab; the others follow the arrow keys. */
function markCurrent(stops: readonly HTMLElement[], current: HTMLElement): void {
	for (const stop of stops) {
		if (stop === current) stop.tabIndex = 0;
		else stop.tabIndex = -1;
	}
}

function arrowStep(key: string): number {
	if (key === 'ArrowRight') return 1;
	if (key === 'ArrowLeft') return -1;
	return 0;
}

/** One Tab stop for the whole toolbar; ← and → move between its controls. */
function roveToolbar(toolbar: HTMLElement): () => void {
	const stops = toolbarStops(toolbar);
	const [first] = stops;
	if (first !== undefined) markCurrent(stops, first);
	const remember = (event: FocusEvent): void => {
		if (!(event.target instanceof HTMLElement)) return;
		if (stops.includes(event.target)) markCurrent(stops, event.target);
	};
	const move = (event: KeyboardEvent): void => {
		const step = arrowStep(event.key);
		if (step === 0) return;
		const { activeElement } = document;
		if (!(activeElement instanceof HTMLElement)) return;
		const current = stops.indexOf(activeElement);
		if (current === -1) return;
		event.preventDefault();
		stops[(current + step + stops.length) % stops.length]?.focus();
	};
	toolbar.addEventListener('focusin', remember);
	toolbar.addEventListener('keydown', move);
	return () => {
		toolbar.removeEventListener('focusin', remember);
		toolbar.removeEventListener('keydown', move);
	};
}

function labelToolbar(toolbar: HTMLElement): void {
	toolbar.setAttribute('aria-label', m.editor_formatting());
	for (const [format, title] of Object.entries(CONTROL_LABELS))
		for (const button of toolbar.querySelectorAll(`button.ql-${format}`))
			button.setAttribute('aria-label', title);
	for (const [value, title] of Object.entries(LIST_LABELS))
		toolbar.querySelector(`button.ql-list[value="${value}"]`)?.setAttribute('aria-label', title);
	toolbar
		.querySelector('.ql-header .ql-picker-label')
		?.setAttribute('aria-label', m.editor_heading_level());
	for (const item of toolbar.querySelectorAll<HTMLElement>('.ql-header .ql-picker-item'))
		item.setAttribute(
			'aria-label',
			HEADER_LABELS[item.dataset['value'] ?? ''] ?? m.editor_normal_text(),
		);
	const source = toolbar.querySelector('button.ql-source');
	if (source) source.textContent = m.editor_source();
}

/** Name the editable root and make the toolbar readable and keyboard-friendly. */
export function describeQuillField(quill: Quill, label: string): () => void {
	quill.root.setAttribute('aria-label', label);
	quill.root.setAttribute('role', 'textbox');
	quill.root.setAttribute('aria-multiline', 'true');
	// A contenteditable element reports tabIndex -1 by default; dialogs contain focus by tabIndex.
	quill.root.tabIndex = 0;
	// Quill inserts its toolbar right before the editor container.
	const toolbar = quill.container.parentElement?.querySelector<HTMLElement>(':scope > .ql-toolbar');
	if (!toolbar) {
		return () => {
			// Nothing was attached.
		};
	}
	labelToolbar(toolbar);
	return roveToolbar(toolbar);
}
