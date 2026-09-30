import type Quill from 'quill';

const CONTROL_LABELS: Readonly<Record<string, string>> = {
	bold: 'Gras',
	italic: 'Italique',
	underline: 'Souligné',
	strike: 'Barré',
	code: 'Code',
	blockquote: 'Citation',
	'code-block': 'Bloc de code',
	link: 'Lien',
	clean: 'Effacer la mise en forme',
	source: 'Texte source',
};
const LIST_LABELS: Readonly<Record<string, string>> = {
	ordered: 'Liste numérotée',
	bullet: 'Liste à puces',
};
const HEADER_LABELS: Readonly<Record<string, string>> = {
	'1': 'Titre 1',
	'2': 'Titre 2',
	'3': 'Titre 3',
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
	toolbar.setAttribute('aria-label', 'Mise en forme');
	for (const [format, title] of Object.entries(CONTROL_LABELS))
		for (const button of toolbar.querySelectorAll(`button.ql-${format}`))
			button.setAttribute('aria-label', title);
	for (const [value, title] of Object.entries(LIST_LABELS))
		toolbar.querySelector(`button.ql-list[value="${value}"]`)?.setAttribute('aria-label', title);
	toolbar
		.querySelector('.ql-header .ql-picker-label')
		?.setAttribute('aria-label', 'Niveau de titre');
	for (const item of toolbar.querySelectorAll<HTMLElement>('.ql-header .ql-picker-item'))
		item.setAttribute('aria-label', HEADER_LABELS[item.dataset['value'] ?? ''] ?? 'Texte normal');
	const source = toolbar.querySelector('button.ql-source');
	if (source) source.textContent = 'Texte source';
}

/** Name the editable root and make the toolbar readable and keyboard-friendly in French. */
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
