import diff from 'fast-diff';
import type Delta from 'quill-delta';

import { LineKind, separated } from './markdown-delta';
import { backticks, inlineMarkdown } from './markdown-inline';

const BLANK = /^[ \t]*$/;

interface ListLevel {
	readonly ordered: boolean;
	readonly marker: string;
	readonly count: number;
}

/** One Markdown line per Quill line, plus code fences and the blank lines `separated` asks for. */
class BlockWriter {
	readonly lines: string[] = [];
	#levels: ListLevel[] = [];
	#code = false;
	/** Where the last non-blank line ended, and what it was. */
	#content = { end: 0, kind: LineKind.Other };

	constructor(readonly fence: string) {}

	line(line: Delta, attributes: Readonly<Record<string, unknown>>): void {
		const code = Boolean(attributes['code-block']);
		if (code !== this.#code) {
			this.lines.push(this.fence);
			this.#code = code;
		}
		const heading: unknown = attributes['header'];
		const list: unknown = attributes['list'];
		if (code) {
			this.#push(quillPlainText(line), LineKind.Other);
			return;
		}
		const text = inlineMarkdown(line.ops);
		if (typeof heading === 'number')
			this.#push(`${'#'.repeat(Math.min(6, Math.max(1, heading)))} ${text}`, LineKind.Other);
		else if (list === 'bullet' || list === 'ordered') {
			let kind = LineKind.Item;
			if (text === '') kind = LineKind.EmptyItem;
			this.#push(this.#item(list === 'ordered', attributes['indent'], text), kind);
		} else if (attributes['blockquote'] === true) this.#push(`> ${text}`, LineKind.Quote);
		else if (BLANK.test(text)) this.lines.push(text);
		// A lone `=` line under a paragraph would turn it into a heading.
		else this.#push(text.replace(/^( {0,3})=/, '$1\\='), LineKind.Paragraph);
	}

	finish(): string {
		if (this.#code) this.lines.push(this.fence);
		return this.lines.join('\n');
	}

	#push(text: string, kind: LineKind): void {
		if (kind !== LineKind.Item && kind !== LineKind.EmptyItem) this.#levels = [];
		if (separated(this.#content.kind, kind)) this.lines.splice(this.#content.end, 0, '');
		this.lines.push(text);
		this.#content = { end: this.lines.length, kind };
	}

	/**
	 * Nested items indent by their parents' marker width; numbering restarts per list. An empty
	 * item drops the space after its marker, without which `- ` would read as a paragraph.
	 */
	#item(ordered: boolean, indent: unknown, text: string): string {
		let depth = 0;
		if (typeof indent === 'number') depth = Math.min(8, Math.max(0, indent));
		const levels = this.#levels.slice(0, depth + 1);
		let prefix = '';
		for (let level = 0; level < depth; level += 1)
			prefix += ' '.repeat(levels[level]?.marker.length ?? 2);
		let count = 1;
		const current = levels[depth];
		if (current?.ordered === ordered) count = current.count + 1;
		let marker = '- ';
		if (ordered) marker = `${count}. `;
		levels[depth] = { ordered, marker, count };
		this.#levels = levels;
		if (text === '') return prefix + marker.trimEnd();
		return prefix + marker + text;
	}
}

/** Markdown-compatible Quill formats only; the shared document continues to contain Markdown. */
export function quillMarkdown(delta: Delta): string {
	const writer = new BlockWriter(backticks(quillPlainText(delta), 3));
	delta.eachLine((line, attributes: Readonly<Record<string, unknown>>) => {
		writer.line(line, attributes);
	});
	return writer.finish();
}

export function quillPlainText(delta: Delta): string {
	return delta.ops
		.map((op) => {
			if (typeof op.insert === 'string') return op.insert;
			return '\ufffc';
		})
		.join('');
}

/** Translate between rendered text and Markdown offsets, skipping formatting delimiters. */
export function translateTextIndex(from: string, to: string, index: number): number {
	let source = 0;
	let target = 0;
	for (const [kind, text] of diff(from, to)) {
		if (kind === 1) {
			target += text.length;
			continue;
		}
		if (index < source + text.length) {
			if (kind === 0) return target + Math.max(0, index - source);
			return target;
		}
		source += text.length;
		if (kind === 0) target += text.length;
	}
	return target;
}
