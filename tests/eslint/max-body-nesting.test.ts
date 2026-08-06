import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint-rules/max-body-nesting.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('max-body-nesting', () => {
	ruleTester.run('max-body-nesting', rule, {
		valid: [
			'function process() { if (ready) { for (const item of items) { item.run(() => execute(item)); } } }',
			'function process() { if (first) {} else if (second) { while (ready) { run(() => work()); } } }',
			'function process() { try { work(); } catch { while (ready) { run(() => work()); } } }',
			'function process() { const value = { nested: { deeply: true } }; return value; }',
			{
				code: 'function process() {}',
				options: [1],
			},
		],
		invalid: [
			{
				code: 'function process() { if (ready) { for (const item of items) { item.run(() => { while (item.pending) { if (item.active) work(item); } }); } } }',
				errors: [{ messageId: 'exceeded', data: { depth: 5, max: 4 } }],
			},
			{
				code: 'const first = () => items.map((item) => values.filter((value) => more.some((candidate) => candidate > value)));',
				options: [3],
				errors: [{ messageId: 'exceeded', data: { depth: 4, max: 3 } }],
			},
			{
				code: 'function process() { if (ready) { while (pending) work(); } }',
				options: [2],
				errors: [{ messageId: 'exceeded', data: { depth: 3, max: 2 } }],
			},
		],
	});
});
