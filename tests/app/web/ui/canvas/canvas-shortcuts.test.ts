// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
	CANVAS_SHORTCUTS,
	CanvasShortcutId,
	matchesShortcut,
	shortcutHint,
	shortcutKeyshortcuts,
	shortcutTitle,
} from '../../../../../src/app/web/ui/canvas/canvas-shortcuts';

function press(id: CanvasShortcutId, init: KeyboardEventInit): boolean {
	return matchesShortcut(CANVAS_SHORTCUTS[id], new KeyboardEvent('keydown', init));
}

const MODIFIERS = ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const;

describe('matchesShortcut', () => {
	it('claims a bare letter whatever its case, and no other letter', () => {
		expect(press(CanvasShortcutId.Edit, { key: 'e' })).toBe(true);
		expect(press(CanvasShortcutId.Edit, { key: 'E' })).toBe(true);
		expect(press(CanvasShortcutId.Edit, { key: 'g' })).toBe(false);
	});

	it.each(MODIFIERS)('yields a letter held with %s', (modifier) => {
		expect(press(CanvasShortcutId.Group, { key: 'g', [modifier]: true })).toBe(false);
	});

	it('lets a bracket keep the Alt or Shift a layout needs, never Ctrl or Cmd', () => {
		expect(press(CanvasShortcutId.Fold, { key: '[', altKey: true, shiftKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Unfold, { key: ']' })).toBe(true);
		expect(press(CanvasShortcutId.Fold, { key: ']' })).toBe(false);
		expect(press(CanvasShortcutId.Fold, { key: '[', ctrlKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Fold, { key: '[', metaKey: true })).toBe(false);
	});

	it('deletes with Delete or Backspace, both bare', () => {
		expect(press(CanvasShortcutId.Delete, { key: 'Delete' })).toBe(true);
		expect(press(CanvasShortcutId.Delete, { key: 'Backspace' })).toBe(true);
		expect(press(CanvasShortcutId.Delete, { key: 'Escape' })).toBe(false);
	});

	it.each(MODIFIERS)('yields Delete and Backspace held with %s', (modifier) => {
		expect(press(CanvasShortcutId.Delete, { key: 'Delete', [modifier]: true })).toBe(false);
		expect(press(CanvasShortcutId.Delete, { key: 'Backspace', [modifier]: true })).toBe(false);
	});

	it('creates a sibling with Ctrl or Cmd, plus Shift, plus Enter', () => {
		const chord = { key: 'Enter', shiftKey: true };
		expect(press(CanvasShortcutId.CreateSibling, { ...chord, ctrlKey: true })).toBe(true);
		expect(press(CanvasShortcutId.CreateSibling, { ...chord, metaKey: true })).toBe(true);
		expect(press(CanvasShortcutId.CreateSibling, chord)).toBe(false);
		expect(press(CanvasShortcutId.CreateSibling, { key: 'Enter', ctrlKey: true })).toBe(false);
		expect(press(CanvasShortcutId.CreateSibling, { ...chord, ctrlKey: true, altKey: true })).toBe(
			false,
		);
		expect(press(CanvasShortcutId.CreateSibling, { key: 'n', shiftKey: true, ctrlKey: true })).toBe(
			false,
		);
	});

	it('undoes with Ctrl or Cmd plus Z, redoes with Shift as well, whatever the case of Z', () => {
		expect(press(CanvasShortcutId.Undo, { key: 'z', ctrlKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Undo, { key: 'z', metaKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Undo, { key: 'z' })).toBe(false);
		expect(press(CanvasShortcutId.Undo, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Undo, { key: 'z', ctrlKey: true, altKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Redo, { key: 'Z', metaKey: true, shiftKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Redo, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Redo, { key: 'z', ctrlKey: true })).toBe(false);
	});

	it('confirms a dialog with Shift and Enter alone, never with Ctrl, Cmd or Alt', () => {
		const chord = { key: 'Enter', shiftKey: true };
		expect(press(CanvasShortcutId.Confirm, chord)).toBe(true);
		expect(press(CanvasShortcutId.Confirm, { key: 'Enter' })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { ...chord, ctrlKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { ...chord, metaKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { ...chord, altKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { key: 'e', shiftKey: true })).toBe(false);
	});

	it.each(Object.values(CANVAS_SHORTCUTS))(
		'yields $id when repeated, composing, or already answered',
		(shortcut) => {
			const init: KeyboardEventInit = {
				key: shortcut.keys[0],
				cancelable: true,
				ctrlKey: shortcut.chord?.primary === true,
				shiftKey: shortcut.chord?.shift === true,
			};
			expect(matchesShortcut(shortcut, new KeyboardEvent('keydown', init))).toBe(true);
			expect(
				matchesShortcut(shortcut, new KeyboardEvent('keydown', { ...init, repeat: true })),
			).toBe(false);
			expect(
				matchesShortcut(shortcut, new KeyboardEvent('keydown', { ...init, isComposing: true })),
			).toBe(false);
			const answered = new KeyboardEvent('keydown', init);
			answered.preventDefault();
			expect(matchesShortcut(shortcut, answered)).toBe(false);
		},
	);
});

it.each([
	[CanvasShortcutId.Edit, 'E', 'Éditer · E', 'e'],
	[CanvasShortcutId.Fold, '[', 'Replier · [', '['],
	[CanvasShortcutId.Unfold, ']', 'Déplier · ]', ']'],
	[CanvasShortcutId.Group, 'G', 'Grouper · G', 'g'],
	[CanvasShortcutId.Junction, 'J', 'Jonction · J', 'j'],
	[CanvasShortcutId.Create, 'N', 'Nouvelle boîte · N', 'n'],
	[
		CanvasShortcutId.CreateSibling,
		'Cmd/Ctrl+Maj+Entrée',
		'Nouvelle boîte sœur · Cmd/Ctrl+Maj+Entrée',
		'Control+Shift+Enter Meta+Shift+Enter',
	],
	[CanvasShortcutId.Delete, 'Suppr', 'Supprimer · Suppr', 'Delete Backspace'],
	[CanvasShortcutId.Undo, 'Cmd/Ctrl+Z', 'Annuler · Cmd/Ctrl+Z', 'Control+z Meta+z'],
	[
		CanvasShortcutId.Redo,
		'Cmd/Ctrl+Maj+Z',
		'Rétablir · Cmd/Ctrl+Maj+Z',
		'Control+Shift+z Meta+Shift+z',
	],
	[CanvasShortcutId.Confirm, 'Maj+Entrée', 'Valider · Maj+Entrée', 'Shift+Enter'],
])('announces %s as %s, titled %s, with aria-keyshortcuts %s', (id, hint, title, aria) => {
	const shortcut = CANVAS_SHORTCUTS[id];
	expect(shortcutHint(shortcut)).toBe(hint);
	expect(shortcutTitle(shortcut)).toBe(title);
	expect(shortcutKeyshortcuts(shortcut)).toBe(aria);
});

it('titles a button with its own wording and the catalogue hint', () => {
	expect(
		shortcutTitle(
			CANVAS_SHORTCUTS[CanvasShortcutId.Create],
			'Nouvelle boîte reliée à la sélection',
		),
	).toBe('Nouvelle boîte reliée à la sélection · N');
});

it('keys every entry by its own id, and never binds one key twice under the same chord', () => {
	const claimed = new Set<string>();
	for (const [id, shortcut] of Object.entries(CANVAS_SHORTCUTS)) {
		expect(shortcut.id).toBe(id);
		for (const key of shortcut.keys) {
			const slot = JSON.stringify([shortcut.chord ?? null, key.toLowerCase()]);
			expect(claimed.has(slot)).toBe(false);
			claimed.add(slot);
		}
	}
});
