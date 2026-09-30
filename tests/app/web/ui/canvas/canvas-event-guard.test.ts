// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
	isEditableTarget,
	isNativeControlTarget,
	isPlainKeyboardEvent,
	isUnclaimedKeyboardEvent,
	isUnmodifiedKeyboardEvent,
} from '../../../../../src/app/web/ui/canvas/canvas-event-guard';

function mounted(html: string): Element {
	document.body.innerHTML = html;
	return document.body.firstElementChild ?? document.body;
}

describe('canvas key targets', () => {
	it('treats every field and editable region as a target the canvas leaves alone', () => {
		expect(isEditableTarget(mounted('<textarea></textarea>'))).toBe(true);
		expect(isEditableTarget(mounted('<input />'))).toBe(true);
		expect(isEditableTarget(mounted('<select></select>'))).toBe(true);
		expect(isEditableTarget(mounted('<div contenteditable=""></div>'))).toBe(true);
		expect(isEditableTarget(mounted('<div contenteditable="plaintext-only"></div>'))).toBe(true);
		expect(isEditableTarget(mounted('<div contenteditable="false"></div>'))).toBe(false);
		expect(isEditableTarget(mounted('<div></div>'))).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});

	it('reaches a target nested inside an editable region', () => {
		expect(
			isEditableTarget(mounted('<div contenteditable=""><span id="caret"></span></div>#caret')),
		).toBe(true);
	});

	it('adds the controls the browser owns to the editable targets', () => {
		expect(isNativeControlTarget(mounted('<button></button>'))).toBe(true);
		expect(isNativeControlTarget(mounted('<a href="/"></a>'))).toBe(true);
		expect(isNativeControlTarget(mounted('<textarea></textarea>'))).toBe(true);
		expect(isNativeControlTarget(mounted('<div contenteditable=""></div>'))).toBe(true);
		expect(isNativeControlTarget(mounted('<div role="button"></div>'))).toBe(false);
		expect(isNativeControlTarget(document.createTextNode('plain'))).toBe(false);
	});
});

describe('canvas key claims', () => {
	const plain = new KeyboardEvent('keydown', { key: 'e' });

	it('claims a plain key nobody else answered', () => {
		expect(isUnclaimedKeyboardEvent(plain)).toBe(true);
		expect(isUnmodifiedKeyboardEvent(plain)).toBe(true);
	});

	it('yields a key another handler already answered', () => {
		const answered = new KeyboardEvent('keydown', { key: 'e', cancelable: true });
		answered.preventDefault();
		expect(isUnclaimedKeyboardEvent(answered)).toBe(false);
		expect(isUnmodifiedKeyboardEvent(answered)).toBe(false);
	});

	it('yields a repeated key and a key typed inside a composition', () => {
		expect(isUnclaimedKeyboardEvent(new KeyboardEvent('keydown', { repeat: true }))).toBe(false);
		expect(isUnclaimedKeyboardEvent(new KeyboardEvent('keydown', { isComposing: true }))).toBe(
			false,
		);
	});

	it.each(['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)(
		'yields a plain key held with %s',
		(modifier) => {
			expect(isUnmodifiedKeyboardEvent(new KeyboardEvent('keydown', { [modifier]: true }))).toBe(
				false,
			);
		},
	);

	it('lets punctuation keep the Alt or Shift a keyboard layout needs, never Ctrl or Cmd', () => {
		const bracket = (init: KeyboardEventInit) =>
			isPlainKeyboardEvent(new KeyboardEvent('keydown', { key: '[', ...init }));
		expect(bracket({ altKey: true, shiftKey: true })).toBe(true);
		expect(bracket({ ctrlKey: true })).toBe(false);
		expect(bracket({ metaKey: true })).toBe(false);
		expect(bracket({ repeat: true })).toBe(false);
	});
});
