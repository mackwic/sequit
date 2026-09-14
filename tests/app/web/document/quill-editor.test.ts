// @vitest-environment jsdom
import Quill from 'quill';
import Delta from 'quill-delta';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { bindQuillMarkdown } from '../../../../src/app/web/document/quill-editor';
import {
	quillEditorOptions,
	QuillEditorProfile,
} from '../../../../src/app/web/document/quill-editor-config';
import { spliceSharedText } from '../../../../src/lib/infrastructure/collaboration/shared-text';

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});
function setup(markdown = 'Alpha', profile = QuillEditorProfile.Description) {
	const doc = new Y.Doc();
	const text = new Y.Text();
	doc.getMap('nodes').set('markdown', text);
	text.insert(0, markdown);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const quill = new Quill(host, {
		...quillEditorOptions(profile),
		modules: { toolbar: false, history: { userOnly: true } },
	});
	const binding = bindQuillMarkdown(
		quill,
		{
			text,
			edit: (next) => {
				doc.transact(() => {
					spliceSharedText(text, next);
				});
			},
			merge: (update) => {
				Y.applyUpdate(doc, update);
			},
		},
		profile,
	);
	cleanup.push(() => {
		binding.destroy();
		doc.destroy();
	});
	return { doc, text, quill, ...binding };
}

describe('formatted Markdown coeditor', () => {
	it('opens existing Markdown without writing and serializes local formatting', () => {
		const view = setup('**Alpha** and *Bravo*');
		expect(view.quill.root.querySelector('strong')?.textContent).toBe('Alpha');
		expect(view.text.toJSON()).toBe('**Alpha** and *Bravo*');
		view.quill.formatText(10, 5, 'italic', false, 'user');
		expect(view.text.toJSON()).toBe('**Alpha** and Bravo');
		view.quill.insertText(5, '!', 'user');
		expect(view.quill.getText()).toBe('Alpha! and Bravo\n');
	});
	it('applies distant edits without recreating Quill or losing the local selection', () => {
		const view = setup('**Alpha**');
		vi.spyOn(view.quill, 'getSelection').mockReturnValue({ index: 2, length: 2 });
		vi.spyOn(view.quill, 'hasFocus').mockReturnValue(true);
		const selection = vi.spyOn(view.quill, 'setSelection').mockReturnValue();
		const root = view.quill.root;
		view.text.insert(2, 'X');
		expect(view.quill.getText()).toBe('XAlpha\n');
		expect(view.quill.root).toBe(root);
		expect(selection).toHaveBeenLastCalledWith(3, 2, 'silent');
		expect(view.editor.toMarkdown(3)).toBe(5);
	});
	it('merges remote edits received during composition and releases listeners on close', async () => {
		const view = setup();
		view.quill.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		view.quill.updateContents(new Delta().retain(5).insert('漢'), 'user');
		view.text.insert(0, 'Remote ');
		expect(view.quill.getText()).toBe('Alpha漢\n');
		view.quill.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		await Promise.resolve();
		expect(view.text.toJSON()).toBe('Remote Alpha漢');
		expect(view.quill.getText()).toBe('Remote Alpha漢\n');
		view.destroy();
		view.quill.insertText(0, 'closed ', 'user');
		expect(view.text.toJSON()).toBe('Remote Alpha漢');
	});
	it('supports empty documents and ignores API updates', () => {
		const view = setup('');
		expect(view.quill.getText()).toBe('\n');
		expect(view.editor.selectionStart).toBe(0);
		expect(view.editor.selectionEnd).toBe(0);
		view.editor.setSelectionRange(0, 0);
		view.quill.insertText(0, 'api', 'api');
		expect(view.text.toJSON()).toBe('');
	});
	it('does not finish a queued composition after its modal is destroyed', async () => {
		const view = setup();
		view.quill.root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		view.quill.root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		view.destroy();
		await Promise.resolve();
		expect(view.text.toJSON()).toBe('Alpha');
	});
});

it.each([
	'# title',
	'- item',
	'1. number',
	'a ~~literal~~',
	'a * b',
	'[not a link](here)',
	'a ** b',
	'a\\b',
])('preserves literal punctuation after a remote Markdown render: %s', (plain) => {
	const view = setup('');
	view.quill.insertText(0, plain, 'user');
	const markdown = view.text.toJSON();
	view.editor.value = markdown;
	expect(view.quill.getText()).toBe(`${plain}\n`);
});

it('round trips adjacent formatting and multiline structures through the real clipboard conversion', () => {
	const view = setup();
	const content = new Delta()
		.insert('bold', { bold: true })
		.insert('both', { bold: true, italic: true })
		.insert('italic', { italic: true })
		.insert('\n')
		.insert('one')
		.insert('\n', { list: 'ordered' })
		.insert('two')
		.insert('\n', { list: 'ordered' })
		.insert('quote')
		.insert('\n', { blockquote: true });
	view.quill.setContents(content, 'user');
	view.editor.value = view.text.toJSON();
	expect(view.quill.getContents().diff(content).ops).toEqual([]);
});

it.each([
	'![Diagramme important](https://example.test/diagram.png "titre")\n\nConclusion',
	'```typescript\nconst answer = 42;\n```\n\nConclusion',
	'| A | B |\n|---|---|\n| un | deux |\n\nConclusion',
	'- [x] Terminé\n- [ ] À faire\n\nConclusion',
	'<aside data-info="private">Texte conservé</aside>\n\nConclusion',
])('preserves unsupported source during a local edit: %s', (markdown) => {
	const view = setup(markdown);
	expect(view.editor.sourceMode).toBe(true);
	expect(view.quill.getText()).toBe(`${markdown}\n`);
	view.quill.insertText(view.quill.getLength() - 1, '!', 'user');
	expect(view.text.toJSON()).toBe(`${markdown}!`);
});

it('switches to source when a peer introduces unsupported content and preserves selection positions', () => {
	const view = setup('Alpha');
	const change = vi.fn();
	view.editor.addEventListener('modechange', change);
	view.text.insert(5, '\n\n| A | B |\n|---|---|\n| one | two |');
	expect(view.editor.sourceMode).toBe(true);
	expect(change).toHaveBeenCalledOnce();
	expect(view.editor.toEditor(3)).toBe(3);
	expect(view.editor.toMarkdown(3)).toBe(3);
	view.quill.insertText(0, 'Local ', 'user');
	expect(view.text.toJSON()).toBe('Local Alpha\n\n| A | B |\n|---|---|\n| one | two |');
	view.text.insert(0, 'Peer ');
	expect(view.quill.getText()).toBe(`${view.text.toJSON()}\n`);
});

it('restricts the body to inline emphasis and preserves existing advanced content as source', () => {
	const view = setup('Alpha', QuillEditorProfile.Body);
	view.quill.formatText(0, 5, 'underline', true, 'user');
	expect(view.text.toJSON()).toBe('<u>Alpha</u>');
	view.editor.value = view.text.toJSON();
	expect(view.editor.sourceMode).toBe(false);
	expect(view.quill.root.querySelector('u')?.textContent).toBe('Alpha');
	const heading = setup('# Heading', QuillEditorProfile.Body);
	expect(heading.editor.sourceMode).toBe(true);
	expect(heading.text.toJSON()).toBe('# Heading');
});

it('keeps titles as plain text and permits switching descriptions to source without writing', () => {
	const plain = setup('A *literal* title', QuillEditorProfile.Plain);
	expect(plain.quill.getText()).toBe('A *literal* title\n');
	plain.quill.insertText(0, '# ', 'user');
	expect(plain.text.toJSON()).toBe('# A *literal* title');
	const view = setup('**Alpha**');
	view.editor.showSource();
	view.editor.showSource();
	expect(view.text.toJSON()).toBe('**Alpha**');
	expect(view.quill.getText()).toBe('**Alpha**\n');
	view.quill.insertText(9, '!', 'user');
	expect(view.text.toJSON()).toBe('**Alpha**!');
});

it('retains image alternative text in the supported rich description format', () => {
	const view = setup('![A diagram](https://example.test/image.png)');
	expect(view.editor.sourceMode).toBe(false);
	view.quill.insertText(view.quill.getLength() - 1, ' caption', 'user');
	expect(view.text.toJSON()).toBe('![A diagram](https://example.test/image.png) caption');
});
