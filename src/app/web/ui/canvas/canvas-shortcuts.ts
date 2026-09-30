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
	Confirm = 'confirm',
	Help = 'help',
	Navigate = 'navigate',
	Select = 'select',
	Cancel = 'cancel',
}

/** Where the « Raccourcis clavier » panel lists a shortcut. */
export enum CanvasShortcutSection {
	Canvas = 'canvas',
	Selection = 'selection',
	Group = 'group',
	Dialog = 'dialog',
}

export interface CanvasShortcut {
	readonly id: CanvasShortcutId;
	readonly section: CanvasShortcutSection;
	/** Action verb as shown on its button: « Éditer », « Grouper », … */
	readonly label: string;
	/** `KeyboardEvent.key` values that trigger it; the first one is the one shown. */
	readonly keys: readonly [string, ...string[]];
	/** Shown instead of the first key when no single key stands for all: « Flèches ». */
	readonly hint?: string;
	/** Exactly these modifiers: Cmd on macOS / Ctrl elsewhere, and Shift. Absent = bare key. */
	readonly chord?: { readonly primary?: true; readonly shift?: true };
}

/** Sections of the « Raccourcis clavier » panel, in display order. */
export const CANVAS_SHORTCUT_SECTIONS: readonly {
	readonly section: CanvasShortcutSection;
	readonly title: string;
}[] = [
	{ section: CanvasShortcutSection.Canvas, title: 'Canvas' },
	{ section: CanvasShortcutSection.Selection, title: 'Sélection' },
	{ section: CanvasShortcutSection.Group, title: 'Groupe' },
	{ section: CanvasShortcutSection.Dialog, title: 'Modale' },
];

/**
 * `Navigate`, `Select` and `Cancel` are listed for the panel only: their handlers keep
 * their own keyup and hover semantics and do not go through `matchesShortcut`.
 */
export const CANVAS_SHORTCUTS: Readonly<Record<CanvasShortcutId, CanvasShortcut>> = {
	[CanvasShortcutId.Edit]: {
		id: CanvasShortcutId.Edit,
		section: CanvasShortcutSection.Selection,
		label: 'Éditer',
		keys: ['e'],
	},
	[CanvasShortcutId.Fold]: {
		id: CanvasShortcutId.Fold,
		section: CanvasShortcutSection.Group,
		label: 'Replier',
		keys: ['['],
	},
	[CanvasShortcutId.Unfold]: {
		id: CanvasShortcutId.Unfold,
		section: CanvasShortcutSection.Group,
		label: 'Déplier',
		keys: [']'],
	},
	[CanvasShortcutId.Group]: {
		id: CanvasShortcutId.Group,
		section: CanvasShortcutSection.Selection,
		label: 'Grouper',
		keys: ['g'],
	},
	[CanvasShortcutId.Junction]: {
		id: CanvasShortcutId.Junction,
		section: CanvasShortcutSection.Selection,
		label: 'Jonction',
		keys: ['j'],
	},
	[CanvasShortcutId.Create]: {
		id: CanvasShortcutId.Create,
		section: CanvasShortcutSection.Canvas,
		label: 'Nouvelle boîte',
		keys: ['n'],
	},
	[CanvasShortcutId.CreateSibling]: {
		id: CanvasShortcutId.CreateSibling,
		section: CanvasShortcutSection.Canvas,
		label: 'Nouvelle boîte sœur',
		keys: ['Enter'],
		chord: { primary: true, shift: true },
	},
	[CanvasShortcutId.Delete]: {
		id: CanvasShortcutId.Delete,
		section: CanvasShortcutSection.Selection,
		label: 'Supprimer',
		keys: ['Delete', 'Backspace'],
	},
	[CanvasShortcutId.Undo]: {
		id: CanvasShortcutId.Undo,
		section: CanvasShortcutSection.Canvas,
		label: 'Annuler',
		keys: ['z'],
		chord: { primary: true },
	},
	[CanvasShortcutId.Redo]: {
		id: CanvasShortcutId.Redo,
		section: CanvasShortcutSection.Canvas,
		label: 'Rétablir',
		keys: ['z'],
		chord: { primary: true, shift: true },
	},
	[CanvasShortcutId.Confirm]: {
		id: CanvasShortcutId.Confirm,
		section: CanvasShortcutSection.Dialog,
		label: 'Valider',
		keys: ['Enter'],
		chord: { shift: true },
	},
	[CanvasShortcutId.Help]: {
		id: CanvasShortcutId.Help,
		section: CanvasShortcutSection.Canvas,
		label: 'Raccourcis clavier',
		keys: ['?'],
	},
	[CanvasShortcutId.Navigate]: {
		id: CanvasShortcutId.Navigate,
		section: CanvasShortcutSection.Canvas,
		label: 'Aller à l’élément voisin',
		keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
		hint: 'Flèches',
	},
	[CanvasShortcutId.Select]: {
		id: CanvasShortcutId.Select,
		section: CanvasShortcutSection.Canvas,
		label: 'Sélectionner / étendre',
		keys: [' '],
	},
	[CanvasShortcutId.Cancel]: {
		id: CanvasShortcutId.Cancel,
		section: CanvasShortcutSection.Canvas,
		label: 'Annuler le geste, fermer',
		keys: ['Escape'],
	},
};

/** The entries of one panel section, in catalogue order. */
export function sectionShortcuts(section: CanvasShortcutSection): CanvasShortcut[] {
	return Object.values(CANVAS_SHORTCUTS).filter((shortcut) => shortcut.section === section);
}

const LETTER = /^[a-z]$/i;
/** Named keys spelled as a French keyboard labels them; any other key is shown upper-cased. */
const KEY_HINTS: Readonly<Record<string, string>> = {
	Delete: 'Suppr',
	Enter: 'Entrée',
	Escape: 'Échap',
	' ': 'Espace',
};
/** `aria-keyshortcuts` separates alternatives with spaces, so the space bar is spelled out. */
const ARIA_KEYS: Readonly<Record<string, string>> = { ' ': 'Space' };

/** Letters must be bare; punctuation may need a layout modifier such as Alt on macOS AZERTY. */
function claimsKey(key: string, event: KeyboardEvent): boolean {
	if (LETTER.test(key)) {
		return isUnmodifiedKeyboardEvent(event) && event.key.toLowerCase() === key.toLowerCase();
	}
	if (key.length === 1) return isPlainKeyboardEvent(event) && event.key === key;
	return isUnmodifiedKeyboardEvent(event) && event.key === key;
}

function claimsChord(shortcut: CanvasShortcut, event: KeyboardEvent): boolean {
	const primary = (event.ctrlKey || event.metaKey) === (shortcut.chord?.primary === true);
	const shift = event.shiftKey === (shortcut.chord?.shift === true);
	const modified = primary && shift && !event.altKey;
	if (!modified || !isUnclaimedKeyboardEvent(event)) return false;
	return shortcut.keys.some((key) => key.toLowerCase() === event.key.toLowerCase());
}

/**
 * Whether this press is the shortcut: letters bare, punctuation may carry Alt or
 * Shift, chords need exactly their declared modifiers and no Alt. Neither the target
 * nor the scope is looked at.
 */
export function matchesShortcut(shortcut: CanvasShortcut, event: KeyboardEvent): boolean {
	if (shortcut.chord !== undefined) return claimsChord(shortcut, event);
	return shortcut.keys.some((key) => claimsKey(key, event));
}

/** Human hint for a `title` or `<kbd>`: 'E', '[', 'Suppr', 'Maj+Entrée', 'Cmd/Ctrl+Maj+Entrée'. */
export function shortcutHint(shortcut: CanvasShortcut): string {
	if (shortcut.hint !== undefined) return shortcut.hint;
	const [key] = shortcut.keys;
	const parts = [KEY_HINTS[key] ?? key.toUpperCase()];
	if (shortcut.chord?.shift === true) parts.unshift('Maj');
	if (shortcut.chord?.primary === true) parts.unshift('Cmd/Ctrl');
	return parts.join('+');
}

/** `title` text of every action button: the label, a middle dot, then the hint. */
export function shortcutTitle(shortcut: CanvasShortcut, label = shortcut.label): string {
	return `${label} · ${shortcutHint(shortcut)}`;
}

/** WAI-ARIA `aria-keyshortcuts`: alternatives separated by spaces, chords joined with `+`. */
export function shortcutKeyshortcuts(shortcut: CanvasShortcut): string {
	const { chord } = shortcut;
	const keys = shortcut.keys.map((key) => ARIA_KEYS[key] ?? key);
	if (chord === undefined) return keys.join(' ');
	let prefixes = [''];
	if (chord.primary === true) prefixes = ['Control+', 'Meta+'];
	let shift = '';
	if (chord.shift === true) shift = 'Shift+';
	return keys.flatMap((key) => prefixes.map((prefix) => `${prefix}${shift}${key}`)).join(' ');
}
