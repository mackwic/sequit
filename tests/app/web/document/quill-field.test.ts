// @vitest-environment jsdom
import Quill from 'quill';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	quillEditorOptions,
	QuillEditorProfile,
} from '../../../../src/app/web/document/quill-editor-config';
import { describeQuillField } from '../../../../src/app/web/document/quill-field';

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop();
	document.body.replaceChildren();
});

function setup(profile: QuillEditorProfile, showSource?: () => void) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const quill = new Quill(host, quillEditorOptions(profile, { showSource }));
	cleanup.push(describeQuillField(quill, 'Contenu A'));
	const toolbar = document.body.querySelector<HTMLElement>('.ql-toolbar');
	return { quill, toolbar };
}
function names(toolbar: HTMLElement | null): string[] {
	return [...(toolbar?.querySelectorAll('button, .ql-picker-label') ?? [])].map(
		(control) => control.getAttribute('aria-label') ?? '',
	);
}

describe('accessible Quill fields', () => {
	it('names the editable root and leaves a plain field without a toolbar', () => {
		const { quill, toolbar } = setup(QuillEditorProfile.Plain);
		expect(quill.root.getAttribute('aria-label')).toBe('Contenu A');
		expect(quill.root.getAttribute('role')).toBe('textbox');
		expect(quill.root.getAttribute('aria-multiline')).toBe('true');
		expect(quill.root.tabIndex).toBe(0);
		expect(toolbar).toBeNull();
	});
	it('translates every description control, including the source button', () => {
		const shown = vi.fn();
		const { toolbar } = setup(QuillEditorProfile.Description, shown);
		expect(toolbar?.getAttribute('aria-label')).toBe('Mise en forme');
		expect(names(toolbar)).toEqual([
			'Niveau de titre',
			'Gras',
			'Italique',
			'Souligné',
			'Barré',
			'Code',
			'Liste numérotée',
			'Liste à puces',
			'Citation',
			'Bloc de code',
			'Lien',
			'Effacer la mise en forme',
			'Texte source',
		]);
		expect(
			[...(toolbar?.querySelectorAll('.ql-header .ql-picker-item') ?? [])].map((item) =>
				item.getAttribute('aria-label'),
			),
		).toEqual(['Titre 1', 'Titre 2', 'Titre 3', 'Texte normal']);
		const source = toolbar?.querySelector<HTMLButtonElement>('button.ql-source');
		expect(source?.textContent).toBe('Texte source');
		source?.click();
		expect(shown).toHaveBeenCalledOnce();
	});
	it('keeps the body toolbar to bold, italic, underline and clean', () => {
		const { toolbar } = setup(QuillEditorProfile.Body);
		expect(names(toolbar)).toEqual(['Gras', 'Italique', 'Souligné', 'Effacer la mise en forme']);
	});
	it('exposes the toolbar as a single Tab stop navigated with the arrow keys', () => {
		const { toolbar } = setup(QuillEditorProfile.Body);
		const [bold, italic, underline, clean] = [
			...(toolbar?.querySelectorAll<HTMLElement>('button') ?? []),
		];
		expect([bold, italic, underline, clean].map((stop) => stop?.tabIndex)).toEqual([0, -1, -1, -1]);
		bold?.focus();
		toolbar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		expect(document.activeElement).toBe(clean);
		expect([bold, clean].map((stop) => stop?.tabIndex)).toEqual([-1, 0]);
		toolbar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(document.activeElement).toBe(bold);
		italic?.focus();
		toolbar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(document.activeElement).toBe(underline);
		const other = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
		toolbar?.dispatchEvent(other);
		expect(document.activeElement).toBe(underline);
		expect(other.defaultPrevented).toBe(false);
	});
	it('ignores arrow keys once the field is unmounted', () => {
		const { toolbar } = setup(QuillEditorProfile.Body);
		const [bold, italic] = [...(toolbar?.querySelectorAll<HTMLElement>('button') ?? [])];
		bold?.focus();
		for (const stop of cleanup.splice(0)) stop();
		toolbar?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		expect(document.activeElement).toBe(bold);
		expect(italic?.tabIndex).toBe(-1);
	});
});
