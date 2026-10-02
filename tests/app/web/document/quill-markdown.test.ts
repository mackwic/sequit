import fc from 'fast-check';
import Delta from 'quill-delta';
import { describe, expect, it } from 'vitest';

import {
	quillMarkdown,
	quillPlainText,
	translateTextIndex,
} from '../../../../src/app/web/document/quill-markdown';

describe('Markdown projection of Quill', () => {
	it('writes supported inline formats and escapes literal Markdown', () => {
		expect(
			quillMarkdown(
				new Delta()
					.insert(' bold ', { bold: true })
					.insert('italic', { italic: true })
					.insert('strike', { strike: true })
					.insert('x`y', { code: true })
					.insert('link', { link: 'https://example.com/a)' })
					.insert('\n'),
			),
		).toBe(' **bold** *italic*~~strike~~`` x`y ``[link](https://example.com/a%29)');
		expect(quillMarkdown(new Delta().insert('*literal* [text] <tag>\n'))).toBe(
			'\\*literal\\* \\[text\\] \\<tag\\>',
		);
		expect(quillMarkdown(new Delta().insert('   \n'))).toBe('   ');
	});
	it('writes headings, lists, quotes, code fences and images', () => {
		const delta = new Delta()
			.insert('Title')
			.insert('\n', { header: 2 })
			.insert('one')
			.insert('\n', { list: 'ordered' })
			.insert('two')
			.insert('\n', { list: 'ordered' })
			.insert('bullet')
			.insert('\n', { list: 'bullet', indent: 1 })
			.insert('quote')
			.insert('\n', { blockquote: true })
			.insert('```')
			.insert('\n', { 'code-block': 'plain' })
			.insert('end\n')
			.insert({ image: 'https://example.com/a)' })
			.insert('\n');
		// A nested item indents by its parent's marker width, so it nests under `2. ` as well.
		expect(quillMarkdown(delta)).toBe(
			'## Title\n1. one\n2. two\n   - bullet\n> quote\n````\n```\n````\nend\n![](https://example.com/a%29)',
		);
		expect(quillMarkdown(new Delta().insert('code').insert('\n', { 'code-block': 'plain' }))).toBe(
			'```\ncode\n```',
		);
		expect(quillMarkdown(new Delta().insert({ unsupported: true }).insert('\n'))).toBe('');
		expect(quillPlainText(delta)).toContain('\ufffc');
	});
	it('preserves plain multiline content, including its empty lines', () => {
		fc.assert(
			fc.property(
				fc.array(fc.stringMatching(/^[a-zA-Z0-9 ]{0,30}$/), { minLength: 1, maxLength: 8 }),
				(lines) => {
					const plain = lines.join('\n');
					expect(quillMarkdown(new Delta().insert(`${plain}\n`))).toBe(plain);
				},
			),
		);
	});
	it.each([
		['Alpha\n', '**Alpha**', 2, 4],
		['**Alpha**', 'Alpha\n', 4, 2],
		['Alpha\n', '# Alpha', 0, 2],
		['[Alpha](url)', 'Alpha\n', 9, 5],
		['a', 'abc', 5, 3],
		['abc', 'a', 2, 1],
	])('maps cursor offsets between %s and %s', (from, to, index, expected) => {
		expect(translateTextIndex(from, to, index)).toBe(expected);
	});
});

it('supports the boolean code block attribute emitted by Quill before a language is chosen', () => {
	expect(
		quillMarkdown(new Delta().insert('const x = `value`').insert('\n', { 'code-block': true })),
	).toBe('```\nconst x = `value`\n```');
});
