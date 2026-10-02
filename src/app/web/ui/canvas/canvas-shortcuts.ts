import { m } from '../../i18n/paraglide/messages';
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
	CreateChild = 'create-child',
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
}[] = (
	[
		[CanvasShortcutSection.Canvas, m.canvas_section_canvas],
		[CanvasShortcutSection.Selection, m.canvas_section_selection],
		[CanvasShortcutSection.Group, m.common_group],
		[CanvasShortcutSection.Dialog, m.canvas_section_dialog],
	] as const
).map(([section, title]) => ({
	section,
	get title(): string {
		return title();
	},
}));

/** A shortcut as declared: its texts are messages, read when shown in the request locale. */
interface ShortcutDeclaration {
	readonly id: CanvasShortcutId;
	readonly section: CanvasShortcutSection;
	readonly label: () => string;
	readonly keys: CanvasShortcut['keys'];
	readonly hint?: () => string;
	readonly chord?: NonNullable<CanvasShortcut['chord']>;
}

function localized({ label, hint, ...shortcut }: ShortcutDeclaration): CanvasShortcut {
	const labelled = {
		...shortcut,
		get label(): string {
			return label();
		},
	};
	if (hint === undefined) return labelled;
	return Object.defineProperty(labelled, 'hint', { get: hint, enumerable: true });
}

/**
 * `Navigate`, `Select` and `Cancel` are listed for the panel only: their handlers keep
 * their own keyup and hover semantics and do not go through `matchesShortcut`.
 */
export const CANVAS_SHORTCUTS: Readonly<Record<CanvasShortcutId, CanvasShortcut>> = {
	[CanvasShortcutId.Edit]: localized({
		id: CanvasShortcutId.Edit,
		section: CanvasShortcutSection.Selection,
		label: m.canvas_shortcut_edit,
		keys: ['e'],
	}),
	[CanvasShortcutId.Fold]: localized({
		id: CanvasShortcutId.Fold,
		section: CanvasShortcutSection.Group,
		label: m.canvas_shortcut_fold,
		keys: ['['],
	}),
	[CanvasShortcutId.Unfold]: localized({
		id: CanvasShortcutId.Unfold,
		section: CanvasShortcutSection.Group,
		label: m.canvas_shortcut_unfold,
		keys: [']'],
	}),
	[CanvasShortcutId.Group]: localized({
		id: CanvasShortcutId.Group,
		section: CanvasShortcutSection.Selection,
		label: m.canvas_shortcut_group,
		keys: ['g'],
	}),
	[CanvasShortcutId.Junction]: localized({
		id: CanvasShortcutId.Junction,
		section: CanvasShortcutSection.Selection,
		label: m.common_junction,
		keys: ['j'],
	}),
	[CanvasShortcutId.Create]: localized({
		id: CanvasShortcutId.Create,
		section: CanvasShortcutSection.Canvas,
		label: m.common_new_box,
		keys: ['n'],
	}),
	[CanvasShortcutId.CreateChild]: localized({
		id: CanvasShortcutId.CreateChild,
		section: CanvasShortcutSection.Selection,
		label: m.canvas_shortcut_create_child,
		keys: ['c'],
	}),
	[CanvasShortcutId.CreateSibling]: localized({
		id: CanvasShortcutId.CreateSibling,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_create_sibling,
		keys: ['Enter'],
		chord: { primary: true, shift: true },
	}),
	[CanvasShortcutId.Delete]: localized({
		id: CanvasShortcutId.Delete,
		section: CanvasShortcutSection.Selection,
		label: m.common_delete,
		keys: ['Delete', 'Backspace'],
	}),
	[CanvasShortcutId.Undo]: localized({
		id: CanvasShortcutId.Undo,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_undo,
		keys: ['z'],
		chord: { primary: true },
	}),
	[CanvasShortcutId.Redo]: localized({
		id: CanvasShortcutId.Redo,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_redo,
		keys: ['z'],
		chord: { primary: true, shift: true },
	}),
	[CanvasShortcutId.Confirm]: localized({
		id: CanvasShortcutId.Confirm,
		section: CanvasShortcutSection.Dialog,
		label: m.canvas_shortcut_confirm,
		keys: ['Enter'],
		chord: { primary: true },
	}),
	[CanvasShortcutId.Help]: localized({
		id: CanvasShortcutId.Help,
		section: CanvasShortcutSection.Canvas,
		label: m.common_keyboard_shortcuts,
		keys: ['?'],
	}),
	[CanvasShortcutId.Navigate]: localized({
		id: CanvasShortcutId.Navigate,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_navigate,
		keys: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
		hint: m.canvas_key_arrows,
	}),
	[CanvasShortcutId.Select]: localized({
		id: CanvasShortcutId.Select,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_select,
		keys: [' '],
	}),
	[CanvasShortcutId.Cancel]: localized({
		id: CanvasShortcutId.Cancel,
		section: CanvasShortcutSection.Canvas,
		label: m.canvas_shortcut_cancel,
		keys: ['Escape'],
	}),
};

/** The entries of one panel section, in catalogue order. */
export function sectionShortcuts(section: CanvasShortcutSection): CanvasShortcut[] {
	return Object.values(CANVAS_SHORTCUTS).filter((shortcut) => shortcut.section === section);
}

const LETTER = /^[a-z]$/i;

/** How a platform labels its keys: macOS uses its key symbols, everything else words. */
export enum ShortcutPlatform {
	Mac = 'mac',
	Other = 'other',
}

interface PlatformNavigator {
	readonly platform?: string;
	readonly userAgentData?: { readonly platform?: string };
}

/** Reads the platform once from `navigator`; absent (server, tests) means `Other`. */
export function detectShortcutPlatform(navigator: PlatformNavigator | undefined): ShortcutPlatform {
	const platform = navigator?.userAgentData?.platform ?? navigator?.platform ?? '';
	if (/mac|iphone|ipad|ipod/i.test(platform)) return ShortcutPlatform.Mac;
	return ShortcutPlatform.Other;
}

const CURRENT_PLATFORM = detectShortcutPlatform(globalThis.navigator);

type ChordModifier = keyof NonNullable<CanvasShortcut['chord']>;

/** How a platform prints its keys: symbols on macOS, words elsewhere. Words are messages. */
interface KeyCaps {
	/** Modifiers in the order the platform writes them: ⇧⌘Z on macOS, Ctrl+Maj+Z elsewhere. */
	readonly modifiers: readonly (readonly [ChordModifier, () => string])[];
	/** Named keys; any other key is shown upper-cased. */
	readonly keys: Readonly<Record<string, () => string>>;
	/** What joins the caps in one line of text. */
	readonly joiner: string;
}

const WORD_KEYS: Readonly<Record<string, () => string>> = {
	Delete: m.canvas_key_delete,
	Enter: m.canvas_key_enter,
	Escape: m.canvas_key_escape,
	' ': m.canvas_key_space,
};
const KEY_CAPS: Readonly<Record<ShortcutPlatform, KeyCaps>> = {
	[ShortcutPlatform.Mac]: {
		modifiers: [
			['shift', () => '⇧'],
			['primary', () => '⌘'],
		],
		keys: { ...WORD_KEYS, Delete: () => '⌫', Enter: () => '↵' },
		joiner: '',
	},
	[ShortcutPlatform.Other]: {
		modifiers: [
			['primary', m.canvas_key_ctrl],
			['shift', m.canvas_key_shift],
		],
		keys: WORD_KEYS,
		joiner: '+',
	},
};
/** The same keys as words, for speech: Mac symbols are not read aloud. */
const KEY_WORDS: Readonly<Record<ShortcutPlatform, KeyCaps>> = {
	[ShortcutPlatform.Mac]: {
		...KEY_CAPS[ShortcutPlatform.Other],
		modifiers: [
			['primary', m.canvas_key_cmd],
			['shift', m.canvas_key_shift],
		],
	},
	[ShortcutPlatform.Other]: KEY_CAPS[ShortcutPlatform.Other],
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

function caps(shortcut: CanvasShortcut, style: KeyCaps): readonly string[] {
	if (shortcut.hint !== undefined) return [shortcut.hint];
	const [key] = shortcut.keys;
	const modifiers = style.modifiers
		.filter(([modifier]) => shortcut.chord?.[modifier] === true)
		.map(([, cap]) => cap());
	return [...modifiers, style.keys[key]?.() ?? key.toUpperCase()];
}

/** One cap per key, modifiers first: ['⇧', '⌘', '↵'] on macOS, ['Ctrl', 'Maj', 'Entrée'] elsewhere. */
export function shortcutCaps(
	shortcut: CanvasShortcut,
	platform = CURRENT_PLATFORM,
): readonly string[] {
	return caps(shortcut, KEY_CAPS[platform]);
}

/** Human hint for a `title`: 'E', '⌫' or 'Suppr', '⇧⌘↵' or 'Ctrl+Maj+Entrée'. */
export function shortcutHint(shortcut: CanvasShortcut, platform = CURRENT_PLATFORM): string {
	return shortcutCaps(shortcut, platform).join(KEY_CAPS[platform].joiner);
}

/** The hint in words a screen reader can say: 'Cmd+Maj+Entrée' on macOS, 'Ctrl+Maj+Entrée' elsewhere. */
export function shortcutWords(shortcut: CanvasShortcut, platform = CURRENT_PLATFORM): string {
	return caps(shortcut, KEY_WORDS[platform]).join(KEY_WORDS[platform].joiner);
}

/** `title` text of every action button: the label, a middle dot, then the hint. */
export function shortcutTitle(shortcut: CanvasShortcut, platform = CURRENT_PLATFORM): string {
	return m.canvas_shortcut_title({ label: shortcut.label, hint: shortcutHint(shortcut, platform) });
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
