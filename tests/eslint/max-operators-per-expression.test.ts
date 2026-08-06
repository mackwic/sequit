import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint-rules/max-operators-per-expression.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('max-operators-per-expression', () => {
	ruleTester.run('max-operators-per-expression', rule, {
		valid: [
			'let score = 0; const after = afterByPeer[slot] ?? 0; const before = beforeByPeer[slot] ?? 0; score += after - before;',
			'const inRange = value >= minimum && value <= maximum;',
			'const result = factory().nested.value;',
			'const values = { first: left ?? 0, second: right ?? 0 };',
			{
				code: 'const selected = items.filter((item) => item > minimum).map((item) => item + 1);',
				options: [1],
			},
			{
				code: 'const fallback = value ?? defaultValue;',
				options: [1],
			},
		],
		invalid: [
			{
				code: 'let score = 0; if (slot < peers.length) score += (afterByPeer[slot] ?? 0) - (beforeByPeer[slot] ?? 0);',
				errors: [{ messageId: 'exceeded', data: { count: 4, max: 3 } }],
			},
			{
				code: 'const result = first && second ? third : fourth ?? fallback;',
				options: [2],
				errors: [{ messageId: 'exceeded', data: { count: 3, max: 2 } }],
			},
			{
				code: 'let score = 0; score += after - before;',
				options: [1],
				errors: [{ messageId: 'exceeded', data: { count: 2, max: 1 } }],
			},
			{
				code: 'let index = 0; const result = !ready ? ++index : -fallback;',
				errors: [{ messageId: 'exceeded', data: { count: 4, max: 3 } }],
			},
		],
	});
});
