import {
	isPlainKeyboardEvent,
	isUnclaimedKeyboardEvent,
	isUnmodifiedKeyboardEvent,
} from './canvas-event-guard';

/**
 * Every labelled canvas action that has a key. Its binding, `title` and
 * `aria-keyshortcuts` all derive from this one declaration.
 */
export enum CanvasShortcutId {
	Edit = 'edit',
	Fold = 'fold',
	Unfold = 'unfold',
	Group = 'group',
	Junction = 'junction',
	Create = 'create',
	CreateSibling = 'create-sibling',
	Delete = 'delete',
	Undo = 'undo',
	Redo = 'redo',
}

export interface CanvasShortcut {
	readonly id: CanvasShortcutId;
	/** Action verb as shown on its button: « Éditer », « Grouper », … */
	readonly label: string;
	/** `KeyboardEvent.key` values that trigger it; the first one is the one shown. */
	readonly keys: readonly [string, ...string[]];
	/** Chord: Cmd on macOS / Ctrl elsewhere, optionally with Shift. Absent = bare key. */
	readonly chord?: { readonly primary: true; readonly shift?: true };
}

export const CANVAS_SHORTCUTS: Readonly<Record<CanvasShortcutId, CanvasShortcut>> = {
	[CanvasShortcutId.Edit]: { id: CanvasShortcutId.Edit, label: 'Éditer', keys: ['e'] },
	[CanvasShortcutId.Fold]: { id: CanvasShortcutId.Fold, label: 'Replier', keys: ['['] },
	[CanvasShortcutId.Unfold]: { id: CanvasShortcutId.Unfold, label: 'Déplier', keys: [']'] },
	[CanvasShortcutId.Group]: { id: CanvasShortcutId.Group, label: 'Grouper', keys: ['g'] },
	[CanvasShortcutId.Junction]: { id: CanvasShortcutId.Junction, label: 'Jonction', keys: ['j'] },
	[CanvasShortcutId.Create]: { id: CanvasShortcutId.Create, label: 'Nouvelle boîte', keys: ['n'] },
	[CanvasShortcutId.CreateSibling]: {
		id: CanvasShortcutId.CreateSibling,
		label: 'Nouvelle boîte sœur',
		keys: ['Enter'],
		chord: { primary: true, shift: true },
	},
	[CanvasShortcutId.Delete]: {
		id: CanvasShortcutId.Delete,
		label: 'Supprimer',
		keys: ['Delete', 'Backspace'],
	},
	[CanvasShortcutId.Undo]: {
		id: CanvasShortcutId.Undo,
		label: 'Annuler',
		keys: ['z'],
		chord: { primary: true },
	},
	[CanvasShortcutId.Redo]: {
		id: CanvasShortcutId.Redo,
		label: 'Rétablir',
		keys: ['z'],
		chord: { primary: true, shift: true },
	},
};

const LETTER = /^[a-z]$/i;
/** Named keys spelled as a French keyboard labels them; any other key is shown upper-cased. */
const KEY_HINTS: Readonly<Record<string, string>> = { Delete: 'Suppr', Enter: 'Entrée' };

/** Letters must be bare; punctuation may need a layout modifier such as Alt on macOS AZERTY. */
function claimsKey(key: string, event: KeyboardEvent): boolean {
	if (LETTER.test(key)) {
		return isUnmodifiedKeyboardEvent(event) && event.key.toLowerCase() === key.toLowerCase();
	}
	if (key.length === 1) return isPlainKeyboardEvent(event) && event.key === key;
	return isUnmodifiedKeyboardEvent(event) && event.key === key;
}

function claimsChord(shortcut: CanvasShortcut, event: KeyboardEvent): boolean {
	const primary = event.ctrlKey || event.metaKey;
	const shift = event.shiftKey === (shortcut.chord?.shift === true);
	const modified = primary && shift && !event.altKey;
	if (!modified || !isUnclaimedKeyboardEvent(event)) return false;
	return shortcut.keys.some((key) => key.toLowerCase() === event.key.toLowerCase());
}

/**
 * Whether this press is the shortcut: letters bare, punctuation may carry Alt or
 * Shift, chords need the primary modifier, Shift exactly as declared and no Alt.
 * Neither the target nor the scope is looked at.
 */
export function matchesShortcut(shortcut: CanvasShortcut, event: KeyboardEvent): boolean {
	if (shortcut.chord !== undefined) return claimsChord(shortcut, event);
	return shortcut.keys.some((key) => claimsKey(key, event));
}

/** Human hint for a `title`: 'E', '[', 'Suppr', 'Cmd/Ctrl+Z', 'Cmd/Ctrl+Maj+Entrée'. */
export function shortcutHint(shortcut: CanvasShortcut): string {
	const [key] = shortcut.keys;
	const hint = KEY_HINTS[key] ?? key.toUpperCase();
	if (shortcut.chord === undefined) return hint;
	if (shortcut.chord.shift === true) return `Cmd/Ctrl+Maj+${hint}`;
	return `Cmd/Ctrl+${hint}`;
}

/** `title` text of every action button: the label, then the hint in parentheses. */
export function shortcutTitle(shortcut: CanvasShortcut, label = shortcut.label): string {
	return `${label} (${shortcutHint(shortcut)})`;
}

/** WAI-ARIA `aria-keyshortcuts`: alternatives separated by spaces, chords joined with `+`. */
export function shortcutKeyshortcuts(shortcut: CanvasShortcut): string {
	if (shortcut.chord === undefined) return shortcut.keys.join(' ');
	let shift = '';
	if (shortcut.chord.shift === true) shift = 'Shift+';
	return shortcut.keys
		.flatMap((key) => [`Control+${shift}${key}`, `Meta+${shift}${key}`])
		.join(' ');
}
