import { Marked, type Token } from 'marked';

interface BodyFormatting {
	readonly strong?: boolean;
	readonly emphasis?: boolean;
	readonly underline?: boolean;
}
export interface BodySpan extends BodyFormatting {
	readonly text: string;
}

const parser = new Marked({
	extensions: [
		{
			name: 'underline',
			level: 'inline',
			tokenizer(source) {
				const match = /^<u>([\s\S]*?)<\/u>/.exec(source);
				if (match?.[1] === undefined) return undefined;
				return { type: 'underline', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
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

/** The canvas receives text and three presentation flags, never generated HTML. */
export function bodyMarkdown(markdown: string): readonly BodySpan[] {
	return spansFromTokens(parser.lexer(markdown), {}) ?? [{ text: markdown }];
}
