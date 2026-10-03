import { staticCss } from './diagnostics-replay-values';

/** A class selector: identifier characters and CSS escapes, as browsers serialize selectors. */
const CLASS_SELECTOR = /\.((?:[-\w\u0080-\uFFFF]|\\(?:[0-9a-fA-F]{1,6} ?|[^\n0-9a-fA-F]))+)/g;
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6}) ?|([^\n0-9a-fA-F]))/g;

interface ClassVocabulary {
	key: string;
	names: ReadonlySet<string>;
}

let vocabulary: ClassVocabulary | undefined;

function unescapeIdentifier(value: string): string {
	return value.replace(
		CSS_ESCAPE,
		(_escape, hex: string | undefined, literal: string | undefined) => {
			if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
			return literal ?? '';
		},
	);
}
function addSelectorClasses(selector: string, names: Set<string>): void {
	for (const match of selector.matchAll(CLASS_SELECTOR)) {
		const name = match[1];
		if (name !== undefined) names.add(unescapeIdentifier(name));
	}
}
function collectRules(rules: CSSRuleList, names: Set<string>): void {
	for (const rule of Array.from(rules)) {
		if (rule instanceof CSSStyleRule) addSelectorClasses(rule.selectorText, names);
		// Media, supports, layer and container blocks, and nested style rules.
		if (rule instanceof CSSGroupingRule) collectRules(rule.cssRules, names);
	}
}
/**
 * Class names the application's own static stylesheets select. They are public build output, so
 * keeping a page class only when it belongs to this set reveals nothing a visitor wrote, while
 * keeping every class that styles the replay.
 */
function stylesheetClasses(): ReadonlySet<string> {
	if (typeof document === 'undefined') return new Set();
	const sheets = Array.from(document.styleSheets);
	const key = sheets.map((sheet) => sheet.href ?? '').join('\n');
	if (vocabulary?.key === key) return vocabulary.names;
	const names = new Set<string>();
	for (const sheet of sheets) {
		if (sheet.href === null || !staticCss(sheet.href, 'LINK', 'stylesheet')) continue;
		try {
			collectRules(sheet.cssRules, names);
		} catch {
			// An unreadable sheet contributes no class names.
		}
	}
	vocabulary = { key, names };
	return names;
}
export function safeClass(value: string): string {
	const names = stylesheetClasses();
	return value
		.split(/\s+/)
		.filter((name) => names.has(name))
		.join(' ');
}
