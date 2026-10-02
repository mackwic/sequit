import type { MarkedToken, Token, Tokens } from 'marked';
import Delta, { type Op } from 'quill-delta';

import { markdownInlineTokens, markdownTokens } from '../ui/content/body-markdown';
import { QuillEditorProfile } from './quill-editor-config';

const BLANK = /^[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const UNDERLINE = 'underline';
const FORMATS: Readonly<Record<string, string>> = {
	strong: 'bold',
	em: 'italic',
	[UNDERLINE]: 'underline',
	del: 'strike',
};
const BODY_INLINE = new Set(['text', 'escape', 'strong', 'em', UNDERLINE, 'br']);
const DESCRIPTION_INLINE = new Set([...BODY_INLINE, 'del', 'codespan', 'link', 'image']);
const LEAF_TEXT = new Set(['text', 'escape', 'codespan']);
const ITEM_CONTENT = new Set(['text', 'paragraph']);
/**
 * Token types shaped like marked's own. The shared lexer adds `underline` and reads format tags
 * as `em`, `strong` and `del` tokens, which carry the same children.
 */
const MARKED_TYPES = new Set<string>([
	'blockquote',
	'br',
	'checkbox',
	'code',
	'codespan',
	'def',
	'del',
	'em',
	'escape',
	'heading',
	'hr',
	'html',
	'image',
	'link',
	'list',
	'list_item',
	'paragraph',
	'space',
	'strong',
	'table',
	'tag',
	'text',
]);

type Attributes = Record<string, unknown>;

export enum LineKind {
	Paragraph = 'paragraph',
	Item = 'item',
	EmptyItem = 'empty-item',
	Quote = 'quote',
	Other = 'other',
}

const CONTINUED_BY_PARAGRAPH = new Set([LineKind.Item, LineKind.EmptyItem, LineKind.Quote]);
const CONTINUED_BY_EMPTY_ITEM = new Set([LineKind.Paragraph, LineKind.Quote]);

/**
 * Whether Markdown needs a blank line between two Quill lines, which the reader then drops: a
 * paragraph line would otherwise continue a list or quote, and an empty item cannot interrupt a
 * paragraph.
 */
export function separated(previous: LineKind, next: LineKind): boolean {
	if (next === LineKind.Paragraph) return CONTINUED_BY_PARAGRAPH.has(previous);
	return next === LineKind.EmptyItem && CONTINUED_BY_EMPTY_ITEM.has(previous);
}

interface Line {
	readonly ops: readonly Op[];
	readonly attributes: Attributes;
	readonly kind: LineKind;
}

interface CodeBlock {
	readonly code: readonly string[];
}

type Block = Line | CodeBlock;

function isMarked(token: Token): token is MarkedToken {
	return MARKED_TYPES.has(token.type);
}

function plainLine(text: string, attributes: Attributes): Line {
	const ops: Op[] = [];
	if (text !== '') ops.push({ insert: text });
	return { ops, attributes, kind: LineKind.Other };
}

/** Split inline content on its line breaks. */
function splitLines(content: Delta): Op[][] {
	const result: Op[][] = [[]];
	for (const op of content.ops) {
		if (typeof op.insert !== 'string') {
			result.at(-1)?.push(op);
			continue;
		}
		op.insert.split('\n').forEach((text, index) => {
			if (index > 0) result.push([]);
			if (text !== '') result.at(-1)?.push({ ...op, insert: text });
		});
	}
	return result;
}

function altText(tokens: readonly Token[]): string | undefined {
	let alt = '';
	for (const token of tokens) {
		if (!isMarked(token) || token.type === 'codespan') return undefined;
		const text = inlineText(token);
		if (text === undefined) return undefined;
		alt += text;
	}
	return alt;
}

/** The text of a leaf inline token; a hard break keeps the spaces that mark it. */
function inlineText(token: MarkedToken): string | undefined {
	if (token.type === 'br') return token.raw.replace(/\\\n$/, '\n');
	if (LEAF_TEXT.has(token.type) && 'text' in token) return token.text;
	return undefined;
}

function blankOp(op: Op): boolean {
	if (op.attributes !== undefined) return false;
	return typeof op.insert === 'string' && BLANK.test(op.insert);
}

function fenced(sourceLines: readonly string[], opening: number, length: number): boolean {
	const closing = sourceLines[opening + length + 1] ?? '';
	return FENCE.test(sourceLines[opening] ?? '') && FENCE.test(closing);
}

/** Lays block lines over the source: each blank source line becomes an empty line. */
class LineLayout {
	readonly #output: Line[] = [];
	#blank: string[] = [];
	#previous = LineKind.Other;

	blank(text: string): void {
		this.#blank.push(text);
	}

	line(line: Line): void {
		if (separated(this.#previous, line.kind)) this.#blank.shift();
		this.#flush();
		this.#output.push(line);
		this.#previous = line.kind;
	}

	code(code: readonly string[]): void {
		this.#flush();
		for (const text of code) this.#output.push(plainLine(text, { 'code-block': 'plain' }));
		this.#previous = LineKind.Other;
	}

	finish(): Line[] {
		this.#flush();
		return this.#output;
	}

	#flush(): void {
		for (const text of this.#blank) this.#output.push(plainLine(text, {}));
		this.#blank = [];
	}
}

/**
 * Read the Markdown subset a field's rich editor writes, line for line. Anything else returns
 * `undefined` so the field can keep the exact source instead of losing what Quill cannot show.
 */
class MarkdownReader {
	readonly #inline: ReadonlySet<string> = BODY_INLINE;
	readonly #rich: boolean;

	constructor(profile: QuillEditorProfile) {
		this.#rich = profile === QuillEditorProfile.Description;
		if (this.#rich) this.#inline = DESCRIPTION_INLINE;
	}

	/** Every non-blank source line consumes the next block line; a code block, its fences too. */
	lines(source: string, tokens: readonly Token[]): Line[] | undefined {
		const blocks: Block[] = [];
		for (const token of tokens) if (!this.#block(token, blocks)) return undefined;
		const layout = new LineLayout();
		const sourceLines = source.split('\n');
		let next = 0;
		for (let index = 0; index < sourceLines.length; index += 1) {
			const text = sourceLines[index] ?? '';
			const block = blocks[next];
			if (BLANK.test(text)) layout.blank(text);
			else if (block === undefined) return undefined;
			else if ('code' in block) {
				if (!fenced(sourceLines, index, block.code.length)) return undefined;
				layout.code(block.code);
				index += block.code.length + 1;
			} else layout.line(block);
			if (!BLANK.test(text)) next += 1;
		}
		if (next !== blocks.length) return undefined;
		return layout.finish();
	}

	#block(token: Token, blocks: Block[]): boolean {
		if (!isMarked(token)) return false;
		if (token.type === 'space') return true;
		if (token.type === 'paragraph')
			return this.#content(token.tokens, {}, LineKind.Paragraph, blocks);
		if (!this.#rich) return false;
		if (token.type === 'heading')
			return this.#single(token.tokens, { header: token.depth }, LineKind.Other, blocks);
		if (token.type === 'blockquote') return this.#quote(token, blocks);
		if (token.type === 'list') return this.#list(token, 0, blocks);
		if (token.type !== 'code') return false;
		if (token.lang !== '' || token.codeBlockStyle === 'indented') return false;
		blocks.push({ code: token.text.split('\n') });
		return true;
	}

	#content(
		tokens: readonly Token[],
		attributes: Attributes,
		kind: LineKind,
		blocks: Block[],
	): boolean {
		const content = new Delta();
		if (!this.inline(tokens, {}, content)) return false;
		const lines = splitLines(content);
		// At the end of the input, marked keeps a last blank line in the paragraph; the source
		// lines already account for it.
		const blank = lines.at(-1)?.every(blankOp);
		if (lines.length > 1 && blank === true) lines.pop();
		for (const ops of lines) blocks.push({ ops, attributes, kind });
		return true;
	}

	#single(
		tokens: readonly Token[],
		attributes: Attributes,
		kind: LineKind,
		blocks: Block[],
	): boolean {
		const content: Block[] = [];
		if (!this.#content(tokens, attributes, kind, content) || content.length !== 1) return false;
		blocks.push(...content);
		return true;
	}

	/** A quote holds paragraphs only; its blank lines stay quoted. */
	#quote(token: Tokens.Blockquote, blocks: Block[]): boolean {
		if (token.tokens.some(({ type }) => type !== 'paragraph' && type !== 'space')) return false;
		const quoted = this.lines(token.text, token.tokens);
		if (quoted === undefined) return false;
		for (const { ops, attributes } of quoted)
			blocks.push({
				ops,
				attributes: { ...attributes, blockquote: true },
				kind: LineKind.Quote,
			});
		return true;
	}

	/** Each item is one line, optionally followed by its nested lists. */
	#list(token: Tokens.List, depth: number, blocks: Block[]): boolean {
		if (token.ordered && token.start !== 1) return false;
		const attributes: Attributes = { list: 'bullet' };
		if (token.ordered) attributes['list'] = 'ordered';
		if (depth > 0) attributes['indent'] = depth;
		return token.items.every((item) => this.#item(item, attributes, depth, blocks));
	}

	#item(item: Tokens.ListItem, attributes: Attributes, depth: number, blocks: Block[]): boolean {
		if (item.task) return false;
		const [first, ...nested] = item.tokens.filter(({ type }) => type !== 'space');
		let content: readonly Token[] = [];
		if (first !== undefined) {
			if (!isMarked(first) || !ITEM_CONTENT.has(first.type)) return false;
			if ('tokens' in first) content = first.tokens ?? [];
		}
		let kind = LineKind.Item;
		if (content.length === 0) kind = LineKind.EmptyItem;
		if (!this.#single(content, attributes, kind, blocks)) return false;
		for (const list of nested) {
			if (!isMarked(list) || list.type !== 'list') return false;
			if (!this.#list(list, depth + 1, blocks)) return false;
		}
		return true;
	}

	/** Append inline content to `content`, unless a token has no Quill equivalent. */
	inline(tokens: readonly Token[], attributes: Attributes, content: Delta): boolean {
		for (const token of tokens) {
			if (!this.#inline.has(token.type)) return false;
			const format = FORMATS[token.type];
			let children: readonly Token[] = [];
			if ('tokens' in token) children = token.tokens ?? [];
			if (format !== undefined) {
				if (!this.inline(children, { ...attributes, [format]: true }, content)) return false;
			} else if (!isMarked(token) || !this.#inlineToken(token, attributes, content)) return false;
		}
		return true;
	}

	#inlineToken(token: MarkedToken, attributes: Attributes, content: Delta): boolean {
		if (token.type === 'text' && token.tokens !== undefined)
			return this.inline(token.tokens, attributes, content);
		if (token.type === 'link')
			return (
				token.title == null &&
				this.inline(token.tokens, { ...attributes, link: token.href }, content)
			);
		if (token.type === 'image') return this.#image(token, attributes, content);
		const text = inlineText(token);
		if (text === undefined) return false;
		let formats = attributes;
		if (token.type === 'codespan') formats = { ...attributes, code: true };
		content.insert(text, formats);
		return true;
	}

	#image(token: Tokens.Image, attributes: Attributes, content: Delta): boolean {
		const alt = altText(token.tokens);
		if (token.title != null || alt === undefined) return false;
		const image = { ...attributes };
		if (alt !== '') image['alt'] = alt;
		content.insert({ image: token.href }, image);
		return true;
	}
}

/** The Quill contents of Markdown written by a field's rich editor, if Quill can show all of it. */
export function markdownDelta(markdown: string, profile: QuillEditorProfile): Delta | undefined {
	const lines = new MarkdownReader(profile).lines(markdown, markdownTokens(markdown));
	if (lines === undefined) return undefined;
	const delta = new Delta();
	for (const { ops, attributes } of lines) {
		for (const op of ops) delta.push(op);
		delta.insert('\n', attributes);
	}
	return delta;
}

/** The Quill contents of one written line, to check it reads back as intended. */
export function markdownLineDelta(markdown: string): Delta | undefined {
	const content = new Delta();
	const reader = new MarkdownReader(QuillEditorProfile.Description);
	if (!reader.inline(markdownInlineTokens(markdown), {}, content)) return undefined;
	return content;
}
