import fc from 'fast-check';
import Delta from 'quill-delta';
import { describe, expect, it } from 'vitest';

import { markdownDelta } from '../../../../src/app/web/document/markdown-delta';
import { QuillEditorProfile } from '../../../../src/app/web/document/quill-editor-config';
import { quillMarkdown, quillPlainText } from '../../../../src/app/web/document/quill-markdown';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

/** Plain characters, Markdown punctuation, and text that looks like links or block syntax. */
const piece = fc.oneof(
	{ weight: 6, arbitrary: fc.constantFrom('a', 'é', '1', ' ', '  ') },
	{ weight: 3, arbitrary: fc.constantFrom(...Array.from('.,;:!?\'"*_`#-+<>[]()~|\\&=@/«»…')) },
	{
		weight: 1,
		arbitrary: fc.constantFrom(
			'https://x.y',
			'www.a.b',
			'a@b.co',
			'&amp;',
			'1. ',
			'- ',
			'> ',
			'# ',
			'===',
			'```',
			'<u>',
			'<em>x</em>',
		),
	},
);
const text = fc.array(piece, { minLength: 1, maxLength: 4 }).map((pieces) => pieces.join(''));

const BODY_MARKS = ['bold', 'italic', 'underline'] as const;
const DESCRIPTION_MARKS = [...BODY_MARKS, 'strike', 'code'] as const;

function run(rich: boolean) {
	let marks: readonly string[] = BODY_MARKS;
	let link = fc.constant<string | null>(null);
	let image = fc.constant<string | null>(null);
	if (rich) {
		marks = DESCRIPTION_MARKS;
		link = fc.option(fc.constantFrom('https://e.test/a', 'https://e.test/b?c=d'), { freq: 3 });
		image = fc.option(fc.constantFrom('', 'A diagram'), { freq: 5 });
	}
	return fc.record({ text, marks: fc.subarray([...marks]), link, image });
}

const block = fc.oneof(
	{ weight: 3, arbitrary: fc.constant<Record<string, unknown>>({}) },
	fc.record<Record<string, unknown>>({ header: fc.integer({ min: 1, max: 3 }) }),
	fc.record<Record<string, unknown>>({
		list: fc.constantFrom('bullet', 'ordered'),
		indent: fc.integer({ min: 0, max: 2 }),
	}),
	fc.constant<Record<string, unknown>>({ blockquote: true }),
	fc.constant<Record<string, unknown>>({ 'code-block': 'plain' }),
);

function document(rich: boolean) {
	let attributes = fc.constant<Record<string, unknown>>({});
	if (rich) attributes = block;
	return fc
		.array(fc.record({ runs: fc.array(run(rich), { maxLength: 4 }), attributes }), {
			minLength: 1,
			maxLength: 5,
		})
		.map(build);
}

/**
 * Quill content an author can type. Lines do not start with spaces, which Markdown reads as
 * indentation; headings and list items keep no edge spaces, which Markdown trims; list items are
 * not empty and only nest one level below the previous item.
 */
function build(
	lines: readonly {
		runs: readonly { text: string; marks: string[]; link: string | null; image: string | null }[];
		attributes: Record<string, unknown>;
	}[],
): Delta {
	const delta = new Delta();
	let depth = -1;
	for (const { runs, attributes } of lines) {
		const code = 'code-block' in attributes;
		let line = new Delta();
		for (const { text: typed, marks, link, image } of runs) {
			const formats: Record<string, unknown> = {};
			for (const mark of marks) formats[mark] = true;
			if (link !== null) formats['link'] = link;
			let text = typed;
			// A format tag closes at the first matching closing tag, even one inside a code span.
			if ('code' in formats) text = text.replaceAll('</', '< /');
			// marked reads backslashes and backtick runs of a link label before its code spans.
			if ('code' in formats && link !== null) text = text.replace(/[`\\]/g, "'");
			if (code) line.insert(text);
			else if (image === null) line.insert(text, formats);
			else {
				// Inline code applies to text only.
				delete formats['code'];
				if (image !== '') formats['alt'] = image;
				line.insert({ image: 'https://e.test/i.png' }, formats);
			}
		}
		const plain = quillPlainText(line);
		let content = plain.trimStart();
		line = line.slice(plain.length - content.length);
		const lineAttributes = { ...attributes };
		if ('list' in lineAttributes || 'header' in lineAttributes) {
			content = content.trimEnd();
			line = line.slice(0, content.length);
		}
		if ('list' in lineAttributes && content === '') delete lineAttributes['list'];
		if ('list' in lineAttributes) {
			const indent = Math.min(Number(lineAttributes['indent']), depth + 1);
			delete lineAttributes['indent'];
			if (indent > 0) lineAttributes['indent'] = indent;
			depth = indent;
		} else {
			delete lineAttributes['indent'];
			depth = -1;
		}
		for (const op of line.ops) delta.push(op);
		delta.insert('\n', lineAttributes);
	}
	return delta;
}

const INVISIBLE_ON_SPACE = new Set(['bold', 'italic', 'strike', 'code']);

/** Bold, italic, strike and code show nothing on a lone space, so Markdown may drop them there. */
function visibleFormatting(delta: Delta): string[] {
	const formatting: string[] = [];
	for (const op of delta.ops) {
		let characters = ['\ufffc'];
		if (typeof op.insert === 'string') characters = Array.from(op.insert);
		for (const character of characters) {
			const space = /^\s$/u.test(character);
			const visible = Object.entries(op.attributes ?? {}).filter(
				([name]) => !space || !INVISIBLE_ON_SPACE.has(name),
			);
			formatting.push(JSON.stringify(visible.sort()));
		}
	}
	return formatting;
}

describe('Markdown written by the rich editors', () => {
	it.each([
		['box content', QuillEditorProfile.Body, false],
		['description', QuillEditorProfile.Description, true],
	])('reopens %s with the same text and visible formatting', (_name, profile, rich) => {
		fc.assert(
			fc.property(document(rich), (written) => {
				const markdown = quillMarkdown(written);
				const read = markdownDelta(markdown, profile);
				expect(read, markdown).toBeDefined();
				if (read === undefined) return;
				expect(quillPlainText(read)).toBe(quillPlainText(written));
				expect(visibleFormatting(read)).toEqual(visibleFormatting(written));
				expect(quillMarkdown(read)).toBe(markdown);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
