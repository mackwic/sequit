import Delta, { type Op } from 'quill-delta';

import { markdownLineDelta } from './markdown-delta';

const LINK = 'link:';
const CODE = 'code';
/** Ties open outermost first; a code span never contains another mark. */
const NESTING = ['link', 'underline', 'strike', 'bold', 'italic', CODE];
const DELIMITERS: Readonly<Record<string, string>> = { bold: '**', italic: '*', strike: '~~' };
const TAGS: Readonly<Record<string, string>> = {
	underline: 'u',
	bold: 'strong',
	italic: 'em',
	strike: 's',
};

enum MarkStyle {
	/** `**bold**`, `*italic*` and `~~strike~~`, which CommonMark only accepts at clean edges. */
	Delimiters = 'delimiters',
	/** `<strong>`, `<em>` and `<s>`, which hold any content. */
	Tags = 'tags',
}

/** One character, or one embedded image, with the marks Markdown can express around it. */
interface Glyph {
	readonly text: string;
	readonly image?: { readonly src: string; readonly alt: string };
	readonly marks: Set<string>;
}

function escapeText(text: string): string {
	return text.replace(/([\\`*_{}[\]()#+\-.!<>|~])/g, '\\$1').replace(/(https?|ftp):/gi, '$1\\:');
}

/** A link or image address encodes what would end its Markdown destination early. */
function destination(url: string): string {
	return url.replace(
		/[ ()<>]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/** A backtick fence longer than any run the content contains. */
export function backticks(text: string, minimum: number): string {
	const runs = text.match(/`+/g) ?? [];
	return '`'.repeat(Math.max(minimum, ...runs.map((run) => run.length + 1)));
}

function opMarks(attributes: Readonly<Record<string, unknown>>): Set<string> {
	const marks = new Set<string>();
	for (const mark of NESTING) if (attributes[mark] === true) marks.add(mark);
	const link: unknown = attributes['link'];
	if (typeof link === 'string') marks.add(`${LINK}${destination(link)}`);
	return marks;
}

function glyphs(ops: readonly Op[]): Glyph[] {
	const result: Glyph[] = [];
	for (const op of ops) {
		const attributes = op.attributes ?? {};
		const marks = opMarks(attributes);
		if (typeof op.insert === 'string') {
			for (const text of op.insert) result.push({ text, marks: new Set(marks) });
			continue;
		}
		const src: unknown = op.insert?.['image'];
		if (typeof src !== 'string') continue;
		let alt = '';
		if (typeof attributes['alt'] === 'string') alt = attributes['alt'];
		marks.delete(CODE);
		const image = { src: destination(src), alt };
		result.push({ text: `![${escapeText(alt)}](${image.src})`, image, marks });
	}
	return result;
}

function isBlank(glyph: Glyph): boolean {
	return glyph.image === undefined && /^\s$/u.test(glyph.text);
}

/** The maximal stretches of neighbouring glyphs that `same` groups together, in order. */
function stretches(
	line: readonly Glyph[],
	same: (left: Glyph, right: Glyph) => boolean,
): Glyph[][] {
	const result: Glyph[][] = [];
	for (const glyph of line) {
		const stretch = result.at(-1);
		const previous = stretch?.at(-1);
		if (previous !== undefined && same(previous, glyph)) stretch?.push(glyph);
		else result.push([glyph]);
	}
	return result;
}

/** Drop `mark` from the blank glyphs at either end of a stretch. */
function trimMark(stretch: readonly Glyph[], mark: string): void {
	const first = stretch.findIndex((glyph) => !isBlank(glyph));
	const last = stretch.findLastIndex((glyph) => !isBlank(glyph));
	stretch.forEach((glyph, index) => {
		if (index < first || index > last) glyph.marks.delete(mark);
	});
}

/**
 * Emphasis cannot begin or end on a space, and a code span holding only spaces reads as plain
 * spaces, so neither keeps its mark there.
 */
function normalize(line: readonly Glyph[]): void {
	for (const mark of Object.keys(DELIMITERS)) {
		const marked = (glyph: Glyph): boolean => glyph.marks.has(mark);
		for (const stretch of stretches(line, (left, right) => marked(left) === marked(right)))
			trimMark(stretch, mark);
	}
	// Any change of mark splits a code span, so each uniformly marked stretch is its own span.
	const signature = (glyph: Glyph): string => [...glyph.marks].sort().join();
	for (const stretch of stretches(line, (left, right) => signature(left) === signature(right)))
		if (stretch.every(isBlank)) for (const glyph of stretch) glyph.marks.delete(CODE);
}

function expected(line: readonly Glyph[]): Delta {
	const delta = new Delta();
	for (const { text, image, marks } of line) {
		const attributes: Record<string, unknown> = {};
		for (const mark of marks) {
			if (mark.startsWith(LINK)) attributes['link'] = mark.slice(LINK.length);
			else attributes[mark] = true;
		}
		if (image === undefined) delta.insert(text, attributes);
		else {
			if (image.alt !== '') attributes['alt'] = image.alt;
			delta.insert({ image: image.src }, attributes);
		}
	}
	return delta;
}

class LineWriter {
	#markdown = '';
	#text = '';
	#code: string | undefined;

	constructor(readonly style: MarkStyle) {}

	glyph(glyph: Glyph): void {
		if (this.#code !== undefined) this.#code += glyph.text;
		else if (glyph.image === undefined) this.#text += glyph.text;
		else {
			this.#flush();
			this.#markdown += glyph.text;
		}
	}

	open(mark: string): void {
		this.#flush();
		if (mark === CODE) this.#code = '';
		else if (mark.startsWith(LINK)) this.#markdown += '[';
		else this.#markdown += this.#delimiter(mark, '');
	}

	close(mark: string): void {
		this.#flush();
		if (mark === CODE) {
			const fence = backticks(this.#code ?? '', 1);
			this.#markdown += `${fence} ${this.#code ?? ''} ${fence}`;
			this.#code = undefined;
		} else if (mark.startsWith(LINK)) this.#markdown += `](${mark.slice(LINK.length)})`;
		else this.#markdown += this.#delimiter(mark, '/');
	}

	finish(): string {
		this.#flush();
		return this.#markdown;
	}

	#delimiter(mark: string, closing: string): string {
		const delimiter = DELIMITERS[mark];
		if (this.style === MarkStyle.Delimiters && delimiter !== undefined) return delimiter;
		return `<${closing}${TAGS[mark] ?? ''}>`;
	}

	#flush(): void {
		this.#markdown += escapeText(this.#text);
		this.#text = '';
	}
}

function runLength(line: readonly Glyph[], start: number, mark: string): number {
	let end = start;
	while (line[end]?.marks.has(mark) === true) end += 1;
	return end - start;
}

function nesting(mark: string): number {
	if (mark.startsWith(LINK)) return 0;
	return NESTING.indexOf(mark);
}

/** Longer marks open outside shorter ones, so a mark rarely closes only to reopen at once. */
function openingOrder(line: readonly Glyph[], index: number, marks: readonly string[]): string[] {
	return marks
		.map((mark) => ({ mark, length: runLength(line, index, mark) }))
		.sort((left, right) => {
			if (left.mark === CODE) return 1;
			if (right.mark === CODE) return -1;
			return right.length - left.length || nesting(left.mark) - nesting(right.mark);
		})
		.map(({ mark }) => mark);
}

function write(line: readonly Glyph[], style: MarkStyle): string {
	const writer = new LineWriter(style);
	const stack: string[] = [];
	for (let index = 0; index <= line.length; index += 1) {
		const marks = line[index]?.marks ?? new Set<string>();
		let keep = stack.findIndex((mark) => !marks.has(mark));
		if (keep === -1) keep = stack.length;
		const opens = [...marks].some((mark) => !stack.slice(0, keep).includes(mark));
		// Nothing opens inside a code span: it closes and reopens around the new mark.
		if (opens && stack[keep - 1] === CODE) keep -= 1;
		for (const mark of stack.splice(keep).reverse()) writer.close(mark);
		const opening = [...marks].filter((mark) => !stack.includes(mark));
		for (const mark of openingOrder(line, index, opening)) {
			writer.open(mark);
			stack.push(mark);
		}
		const glyph = line[index];
		if (glyph !== undefined) writer.glyph(glyph);
	}
	return writer.finish();
}

/**
 * Serialize one Quill line as Markdown that reads back to the same line. Delimiters are kept
 * where CommonMark accepts them; otherwise the line uses inline tags, which always do.
 */
export function inlineMarkdown(ops: readonly Op[]): string {
	const line = glyphs(ops);
	normalize(line);
	const target = expected(line);
	const delimited = write(line, MarkStyle.Delimiters);
	if (markdownLineDelta(delimited)?.diff(target).ops.length === 0) return delimited;
	return write(line, MarkStyle.Tags);
}
