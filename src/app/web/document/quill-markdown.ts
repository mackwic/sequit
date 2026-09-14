import diff from 'fast-diff';
import type Delta from 'quill-delta';

function escapeText(text: string): string {
	return text.replace(/([\\`*_{}[\]()#+\-.!<>|~])/g, '\\$1');
}

function inline(text: string, attributes: Readonly<Record<string, unknown>>): string {
	const content = text.trim();
	if (content.length === 0) return text;
	const start = text.indexOf(content);
	let result = escapeText(content);
	if (attributes['code'] === true) {
		const delimiter = backticks(text, 1);
		return `${delimiter} ${text} ${delimiter}`;
	}
	if (attributes['bold'] === true) result = `**${result}**`;
	if (attributes['italic'] === true) result = `*${result}*`;
	if (attributes['strike'] === true) result = `~~${result}~~`;
	const link: unknown = attributes['link'];
	if (typeof link === 'string') result = `[${result}](${link.replaceAll(')', '%29')})`;
	return text.slice(0, start) + result + text.slice(start + content.length);
}

function block(
	text: string,
	plain: string,
	attributes: Readonly<Record<string, unknown>>,
	ordered: number,
): string {
	const heading: unknown = attributes['header'];
	const indent: unknown = attributes['indent'];
	let prefix = '';
	if (typeof indent === 'number') prefix = '  '.repeat(Math.min(8, Math.max(0, indent)));
	if (typeof heading === 'number')
		return `${'#'.repeat(Math.min(6, Math.max(1, heading)))} ${text}`;
	if (attributes['list'] === 'bullet') return `${prefix}- ${text}`;
	if (attributes['list'] === 'ordered') return `${prefix}${ordered}. ${text}`;
	if (attributes['blockquote'] === true) return `> ${text}`;
	const codeBlock: unknown = attributes['code-block'];
	if (typeof codeBlock === 'string') return plain;
	if (codeBlock === true) return plain;
	return text;
}

function backticks(text: string, minimum: number): string {
	const runs = text.match(/`+/g) ?? [];
	return '`'.repeat(Math.max(minimum, ...runs.map((run) => run.length + 1)));
}

function formattedLine(line: Delta): string {
	return line.ops
		.map((op) => {
			if (typeof op.insert === 'string') return inline(op.insert, op.attributes ?? {});
			const image: unknown = op.insert?.['image'];
			if (typeof image === 'string') return `![](${image.replaceAll(')', '%29')})`;
			return '';
		})
		.join('');
}

/** Markdown-compatible Quill formats only; the shared document continues to contain Markdown. */
export function quillMarkdown(delta: Delta): string {
	const lines: string[] = [];
	let ordered = 0;
	const state = { code: false };
	const fence = backticks(quillPlainText(delta), 3);
	delta.eachLine((line, attributes: Readonly<Record<string, unknown>>) => {
		const nextCode = Boolean(attributes['code-block']);
		if (nextCode !== state.code) {
			lines.push(fence);
			state.code = nextCode;
		}
		if (attributes['list'] === 'ordered') ordered += 1;
		else ordered = 0;
		lines.push(block(formattedLine(line), quillPlainText(line), attributes, ordered));
	});
	if (state.code) lines.push(fence);
	return lines.join('\n');
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
