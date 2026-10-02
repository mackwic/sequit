// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
	CANVAS_SHORTCUT_SECTIONS,
	CANVAS_SHORTCUTS,
	CanvasShortcutId,
	detectShortcutPlatform,
	matchesShortcut,
	sectionShortcuts,
	shortcutCaps,
	shortcutHint,
	shortcutKeyshortcuts,
	ShortcutPlatform,
	shortcutTitle,
	shortcutWords,
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

	it('confirms a dialog with Ctrl or Cmd and Enter alone, never with Shift or Alt', () => {
		const chord = { key: 'Enter', ctrlKey: true };
		expect(press(CanvasShortcutId.Confirm, chord)).toBe(true);
		expect(press(CanvasShortcutId.Confirm, { key: 'Enter', metaKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Confirm, { key: 'Enter' })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { key: 'Enter', shiftKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { ...chord, shiftKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { ...chord, altKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Confirm, { key: 'e', ctrlKey: true })).toBe(false);
	});

	it('opens the help with ?, keeping the Shift a layout needs, never with Ctrl or Cmd', () => {
		expect(press(CanvasShortcutId.Help, { key: '?', shiftKey: true })).toBe(true);
		expect(press(CanvasShortcutId.Help, { key: '?' })).toBe(true);
		expect(press(CanvasShortcutId.Help, { key: '/', shiftKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Help, { key: '?', shiftKey: true, ctrlKey: true })).toBe(false);
		expect(press(CanvasShortcutId.Help, { key: '?', shiftKey: true, metaKey: true })).toBe(false);
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
	[CanvasShortcutId.Edit, 'E', 'E', 'e'],
	[CanvasShortcutId.Fold, '[', '[', '['],
	[CanvasShortcutId.Unfold, ']', ']', ']'],
	[CanvasShortcutId.Group, 'G', 'G', 'g'],
	[CanvasShortcutId.Junction, 'J', 'J', 'j'],
	[CanvasShortcutId.Create, 'N', 'N', 'n'],
	[CanvasShortcutId.CreateChild, 'C', 'C', 'c'],
	[
		CanvasShortcutId.CreateSibling,
		'Ctrl+Maj+Entrée',
		'⇧⌘↵',
		'Control+Shift+Enter Meta+Shift+Enter',
	],
	[CanvasShortcutId.Delete, 'Suppr', '⌫', 'Delete Backspace'],
	[CanvasShortcutId.Undo, 'Ctrl+Z', '⌘Z', 'Control+z Meta+z'],
	[CanvasShortcutId.Redo, 'Ctrl+Maj+Z', '⇧⌘Z', 'Control+Shift+z Meta+Shift+z'],
	[CanvasShortcutId.Confirm, 'Ctrl+Entrée', '⌘↵', 'Control+Enter Meta+Enter'],
	[CanvasShortcutId.Help, '?', '?', '?'],
	[CanvasShortcutId.Navigate, 'Flèches', 'Flèches', 'ArrowUp ArrowDown ArrowLeft ArrowRight'],
	[CanvasShortcutId.Select, 'Espace', 'Espace', 'Space'],
	[CanvasShortcutId.Cancel, 'Échap', 'Échap', 'Escape'],
])('announces %s as %s, or %s on macOS, with aria-keyshortcuts %s', (id, words, symbols, aria) => {
	const shortcut = CANVAS_SHORTCUTS[id];
	expect(shortcutHint(shortcut, ShortcutPlatform.Other)).toBe(words);
	expect(shortcutHint(shortcut, ShortcutPlatform.Mac)).toBe(symbols);
	expect(shortcutTitle(shortcut, ShortcutPlatform.Other)).toBe(`${shortcut.label} · ${words}`);
	expect(shortcutKeyshortcuts(shortcut)).toBe(aria);
});

it('splits a chord into one cap per key, modifiers in the platform order', () => {
	const redo = CANVAS_SHORTCUTS[CanvasShortcutId.Redo];
	expect(shortcutCaps(redo, ShortcutPlatform.Other)).toEqual(['Ctrl', 'Maj', 'Z']);
	expect(shortcutCaps(redo, ShortcutPlatform.Mac)).toEqual(['⇧', '⌘', 'Z']);
	expect(shortcutCaps(CANVAS_SHORTCUTS[CanvasShortcutId.Navigate], ShortcutPlatform.Mac)).toEqual([
		'Flèches',
	]);
});

it('speaks macOS symbols as words, naming the command key', () => {
	const sibling = CANVAS_SHORTCUTS[CanvasShortcutId.CreateSibling];
	expect(shortcutWords(sibling, ShortcutPlatform.Mac)).toBe('Cmd+Maj+Entrée');
	expect(shortcutWords(sibling, ShortcutPlatform.Other)).toBe('Ctrl+Maj+Entrée');
	expect(shortcutWords(CANVAS_SHORTCUTS[CanvasShortcutId.Delete], ShortcutPlatform.Mac)).toBe(
		'Suppr',
	);
});

it('detects macOS from userAgentData first, then navigator.platform, and defaults to Other', () => {
	expect(detectShortcutPlatform({ userAgentData: { platform: 'macOS' } })).toBe(
		ShortcutPlatform.Mac,
	);
	expect(detectShortcutPlatform({ platform: 'MacIntel' })).toBe(ShortcutPlatform.Mac);
	expect(detectShortcutPlatform({ platform: 'iPhone' })).toBe(ShortcutPlatform.Mac);
	expect(
		detectShortcutPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }),
	).toBe(ShortcutPlatform.Other);
	expect(detectShortcutPlatform({ platform: 'Linux x86_64' })).toBe(ShortcutPlatform.Other);
	expect(detectShortcutPlatform(undefined)).toBe(ShortcutPlatform.Other);
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

it('lists every entry in exactly one panel section, and leaves no section empty', () => {
	const listed = CANVAS_SHORTCUT_SECTIONS.flatMap(({ section }) => {
		const entries = sectionShortcuts(section);
		expect(entries.length).toBeGreaterThan(0);
		expect(entries.every((shortcut) => shortcut.section === section)).toBe(true);
		return entries.map(({ id }) => id);
	});
	expect(listed).toHaveLength(Object.values(CanvasShortcutId).length);
	expect(new Set(listed)).toEqual(new Set(Object.values(CanvasShortcutId)));
});
