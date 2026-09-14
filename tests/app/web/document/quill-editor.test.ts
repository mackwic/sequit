// @vitest-environment jsdom
import Quill from 'quill';
import Delta from 'quill-delta';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { bindQuillMarkdown } from '../../../../src/app/web/document/quill-editor';
import { spliceSharedText } from '../../../../src/lib/infrastructure/collaboration/shared-text';

const cleanup: (() => void)[] = [];
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop();
	document.body.replaceChildren();
	vi.restoreAllMocks();
});
function setup(markdown = 'Alpha') {
	const doc = new Y.Doc();
	const text = new Y.Text();
	doc.getMap('nodes').set('markdown', text);
	text.insert(0, markdown);
	const host = document.createElement('div');
	document.body.appendChild(host);
	const quill = new Quill(host, { modules: { toolbar: false, history: { userOnly: true } } });
	const binding = bindQuillMarkdown(quill, {
		text,
		edit: (next) => {
			doc.transact(() => {
				spliceSharedText(text, next);
			});
		},
		merge: (update) => {
			Y.applyUpdate(doc, update);
		},
	});
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
