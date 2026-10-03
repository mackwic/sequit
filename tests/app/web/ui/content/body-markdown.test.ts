import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

import NodeBody from '../../../../../src/app/web/ui/components/canvas/NodeBody.svelte';
import { bodyMarkdown } from '../../../../../src/lib/infrastructure/content/body-markdown';

describe('compact Markdown body', () => {
	it('projects nested emphasis and underline without producing HTML', () => {
		expect(bodyMarkdown('**Bold *and italic*** <u>underlined **too**</u>')).toEqual([
			{ strong: true, text: 'Bold ' },
			{ strong: true, emphasis: true, text: 'and italic' },
			{ text: ' ' },
			{ underline: true, text: 'underlined ' },
			{ underline: true, strong: true, text: 'too' },
		]);
	});
	it('reads format tags, which the editor writes where `*` would stay literal', () => {
		expect(bodyMarkdown('<em>Alpha.</em>bravo <strong>x<u>y</u></strong>')).toEqual([
			{ emphasis: true, text: 'Alpha.' },
			{ text: 'bravo ' },
			{ strong: true, text: 'x' },
			{ strong: true, underline: true, text: 'y' },
		]);
		expect(bodyMarkdown('<s>struck</s>')).toEqual([{ text: '<s>struck</s>' }]);
	});
	it('preserves line breaks, paragraph spacing, and escaped punctuation', () => {
		expect(bodyMarkdown('One\nline\n\nSecond \\*literal\\*')).toEqual([
			{ text: 'One\nline' },
			{ text: '\n\n' },
			{ text: 'Second ' },
			{ text: '*' },
			{ text: 'literal' },
			{ text: '*' },
		]);
		expect(bodyMarkdown('first  \nsecond')).toEqual([
			{ text: 'first' },
			{ text: '\n' },
			{ text: 'second' },
		]);
		expect(bodyMarkdown('')).toEqual([]);
	});
	it.each([
		'<img src=x onerror=alert(1)>',
		'<script>alert(1)</script>',
		'<u onclick="alert(1)">unsafe</u>',
		'[unsafe](javascript:alert(1))',
		'# Imported heading',
		'![alt](https://example.test/image.png)',
		'| A | B |\n|---|---|\n| a | b |',
	])('keeps unsupported markup literal: %s', (markdown) => {
		expect(bodyMarkdown(markdown)).toEqual([{ text: markdown }]);
	});
});

it('renders emphasis as styled text and escapes unsupported HTML in the actual component', () => {
	const styled = render(NodeBody, {
		props: { markdown: '**Bold** *italic* <u>underlined</u>' },
	}).body;
	expect(styled).toContain('strong');
	expect(styled).toContain('emphasis');
	expect(styled).toContain('underline');
	const unsafe = render(NodeBody, { props: { markdown: '<img src=x onerror=alert(1)>' } }).body;
	expect(unsafe).not.toContain('<img');
	expect(unsafe).toContain('&lt;img');
});
