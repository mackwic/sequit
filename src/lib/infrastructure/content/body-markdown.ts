import { Marked, type Token, type TokensList } from 'marked';

interface BodyFormatting {
	readonly strong?: boolean;
	readonly emphasis?: boolean;
	readonly underline?: boolean;
}
export interface BodySpan extends BodyFormatting {
	readonly text: string;
}

/**
 * Inline tags carry formatting `*` delimiters cannot, such as emphasis ending in punctuation
 * right before a letter. They become the same tokens as their Markdown counterparts.
 */
const FORMAT_TAGS: Readonly<Record<string, string>> = {
	u: 'underline',
	em: 'em',
	strong: 'strong',
	s: 'del',
};

const parser = new Marked({
	extensions: [
		{
			name: 'formatTag',
			level: 'inline',
			tokenizer(source) {
				const match = /^<(u|em|strong|s)>([\s\S]*?)<\/\1>/.exec(source);
				const type = FORMAT_TAGS[match?.[1] ?? ''];
				if (match?.[2] === undefined || type === undefined) return undefined;
				return { type, raw: match[0], tokens: this.lexer.inlineTokens(match[2]) };
			},
		},
	],
});

function formattedSpans(token: Token, formatting: BodyFormatting): readonly BodySpan[] | undefined {
	if (!('tokens' in token)) return undefined;
	if (token.type === 'strong')
		return spansFromTokens(token.tokens, { ...formatting, strong: true });
	if (token.type === 'em') return spansFromTokens(token.tokens, { ...formatting, emphasis: true });
	if (token.type === 'underline')
		return spansFromTokens(token.tokens, { ...formatting, underline: true });
	if (token.type === 'paragraph' || token.type === 'text')
		return spansFromTokens(token.tokens, formatting);
	return undefined;
}

function spanForToken(token: Token, formatting: BodyFormatting): readonly BodySpan[] | undefined {
	if (token.type === 'space') return [{ ...formatting, text: token.raw }];
	if (token.type === 'br') return [{ ...formatting, text: '\n' }];
	const literal = token.type === 'escape' || token.type === 'text';
	if (literal && !('tokens' in token)) {
		const text: unknown = token.text;
		if (typeof text === 'string') return [{ ...formatting, text }];
		return undefined;
	}
	return formattedSpans(token, formatting);
}

function spansFromTokens(
	tokens: readonly Token[],
	formatting: BodyFormatting,
): readonly BodySpan[] | undefined {
	const spans: BodySpan[] = [];
	for (const token of tokens) {
		const next = spanForToken(token, formatting);
		if (next === undefined) return undefined;
		spans.push(...next);
	}
	return spans;
}

/** The Markdown dialect shared by the canvas and the box editor, including its format tags. */
export function markdownTokens(markdown: string): TokensList {
	return parser.lexer(markdown);
}

/** The inline tokens of one line of that dialect, outside any block structure. */
export function markdownInlineTokens(markdown: string): Token[] {
	return parser.Lexer.lexInline(markdown, parser.defaults);
}

/** The canvas receives text and three presentation flags, never generated HTML. */
export function bodyMarkdown(markdown: string): readonly BodySpan[] {
	return spansFromTokens(markdownTokens(markdown), {}) ?? [{ text: markdown }];
}
