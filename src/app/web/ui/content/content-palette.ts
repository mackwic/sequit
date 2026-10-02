import { m } from '../../i18n/paraglide/messages';

interface ContentColorFamily {
	/** Read when shown, in the request locale. */
	readonly label: string;
	readonly colors: readonly [string, string, string];
}

const families: readonly (readonly [() => string, ContentColorFamily['colors']])[] = [
	[m.content_palette_gray, ['#d6d3d1', '#78716c', '#292524']],
	[m.content_palette_slate, ['#cbd5e1', '#64748b', '#334155']],
	[m.content_palette_brown, ['#d6b89c', '#a16b45', '#6b4226']],
	[m.content_palette_red, ['#fca5a5', '#ef4444', '#b91c1c']],
	[m.content_palette_coral, ['#fdb4a0', '#f47761', '#b94735']],
	[m.content_palette_orange, ['#fdba74', '#f97316', '#c2410c']],
	[m.content_palette_amber, ['#fcd34d', '#f59e0b', '#b45309']],
	[m.content_palette_yellow, ['#fef08a', '#eab308', '#a16207']],
	[m.content_palette_lime, ['#d9f99d', '#84cc16', '#4d7c0f']],
	[m.content_palette_green, ['#86efac', '#22c55e', '#15803d']],
	[m.content_palette_mint, ['#a7f3d0', '#34d399', '#047857']],
	[m.content_palette_teal, ['#99f6e4', '#14b8a6', '#0f766e']],
	[m.content_palette_cyan, ['#a5f3fc', '#06b6d4', '#0e7490']],
	[m.content_palette_blue, ['#93c5fd', '#3b82f6', '#1d4ed8']],
	[m.content_palette_indigo, ['#a5b4fc', '#6366f1', '#4338ca']],
	[m.content_palette_violet, ['#c4b5fd', '#8b5cf6', '#6d28d9']],
	[m.content_palette_plum, ['#e9b6ee', '#ba60c8', '#7f308a']],
	[m.content_palette_pink, ['#f9a8d4', '#ec4899', '#be185d']],
];

/** Content choices have no application status semantics. Custom RGB remains available. */
export const contentPalette: readonly ContentColorFamily[] = families.map(([label, colors]) => ({
	get label(): string {
		return label();
	},
	colors,
}));
