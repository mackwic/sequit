import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	sharedTextarea,
	type SharedTextareaElement,
} from '../../../../src/app/web/document/shared-textarea';
import { spliceSharedText } from '../../../../src/lib/infrastructure/collaboration/shared-text';

class Textarea extends EventTarget implements SharedTextareaElement {
	value = '';
	selectionStart = 0;
	selectionEnd = 0;
	selectionDirection: SharedTextareaElement['selectionDirection'] = 'none';
	setSelectionRange(start: number, end: number, direction = this.selectionDirection): void {
		this.selectionStart = start;
		this.selectionEnd = end;
		this.selectionDirection = direction;
	}
}

function setup() {
	const document = new Y.Doc();
	const text = new Y.Text('Alpha');
	document.getMap('node').set('markdown', text);
	const element = new Textarea();
	const binding = sharedTextarea(element, {
		text,
		edit: (next) => {
			document.transact(() => {
				spliceSharedText(text, next);
			});
		},
		merge: (update) => {
			Y.applyUpdate(document, update);
		},
	});
	return { document, text, element, binding };
}

describe('textarea binding', () => {
	it('keeps local input and a backward selection when receiving a remote insertion', () => {
		const { document, text, element, binding } = setup();
		expect(element.value).toBe('Alpha');
		element.value = 'Alpha modifié';
		element.setSelectionRange(13, 13);
		element.dispatchEvent(new Event('input'));
		expect(text.toJSON()).toBe('Alpha modifié');
		element.setSelectionRange(2, 5, 'backward');
		document.transact(() => {
			text.insert(0, 'X');
		});
		expect(element.value).toBe('XAlpha modifié');
		expect([element.selectionStart, element.selectionEnd, element.selectionDirection]).toEqual([
			3,
			6,
			'backward',
		]);
		binding.destroy();
		document.destroy();
	});

	it('preserves a composition draft while remote text arrives, then merges both edits', () => {
		const { document, text, element, binding } = setup();
		element.setSelectionRange(5, 5);
		element.dispatchEvent(new Event('compositionstart'));
		element.value = 'Alpha漢';
		element.setSelectionRange(6, 6);
		element.dispatchEvent(new Event('input'));
		document.transact(() => {
			text.insert(0, 'X');
		});
		expect(element.value).toBe('Alpha漢');
		expect(text.toJSON()).toBe('XAlpha');
		element.dispatchEvent(new Event('compositionend'));
		expect(text.toJSON()).toBe('XAlpha漢');
		expect(element.value).toBe('XAlpha漢');
		expect(element.selectionEnd).toBe(7);
		binding.destroy();
		document.destroy();
	});

	it('detaches all listeners when closing the editor, including during composition', () => {
		const { document, text, element, binding } = setup();
		element.dispatchEvent(new Event('compositionend'));
		element.dispatchEvent(new Event('compositionstart'));
		binding.destroy();
		text.insert(0, 'Remote ');
		expect(element.value).toBe('Alpha');
		element.value = 'Discarded';
		element.dispatchEvent(new Event('input'));
		expect(text.toJSON()).toBe('Remote Alpha');
		document.destroy();
	});

	it('requires attached shared text', () => {
		expect(() => {
			sharedTextarea(new Textarea(), {
				text: new Y.Text(),
				edit: () => undefined,
				merge: () => undefined,
			});
		}).toThrow('not attached');
	});
});

it('finishes an IME composition safely when its node was deleted remotely', () => {
	const { document, element, binding } = setup();
	element.dispatchEvent(new Event('compositionstart'));
	element.value = 'Alpha漢';
	element.setSelectionRange(6, 6);
	document.getMap('node').delete('markdown');
	expect(() => element.dispatchEvent(new Event('compositionend'))).not.toThrow();
	expect(document.getMap('node').has('markdown')).toBe(false);
	expect(element.value).toBe('');
	binding.destroy();
	document.destroy();
});

it('ignores a composition start arriving after its shared text was removed', () => {
	const { document, element, binding } = setup();
	document.getMap('node').delete('markdown');
	expect(() => element.dispatchEvent(new Event('compositionstart'))).not.toThrow();
	binding.destroy();
	document.destroy();
});

it('changes an emoji without splitting a shared trailing surrogate', () => {
	const { document, text, element, binding } = setup();
	element.value = '\uD83D\uDE00';
	element.dispatchEvent(new Event('input'));
	element.value = '\uD83E\uDE00';
	element.dispatchEvent(new Event('input'));
	expect(text.toJSON()).toBe('\uD83E\uDE00');
	binding.destroy();
	document.destroy();
});
