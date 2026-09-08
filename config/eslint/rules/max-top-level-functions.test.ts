import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from './max-top-level-functions.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('max-top-level-functions', () => {
	ruleTester.run('max-top-level-functions', rule, {
		valid: [
			{ code: 'function first() {}\nconst second = () => {};', options: [2] },
			{ code: 'export function first() {}\nexport const second = function () {};', options: [2] },
			{ code: 'const first = () => {}, second = function named() {};', options: [2] },
			{
				code: 'const first = (() => {}) as () => void;\nconst second = (() => {}) satisfies () => void;',
				options: [2],
			},
			{
				code: 'function outer() { function nested() {} return () => nested(); }',
				options: [1],
			},
			{
				code: 'items.map(() => true);\nclass Example { method() {} }\nconst object = { method() {} };',
				options: [0],
			},
			{ code: 'export default function () {}', options: [0] },
		],
		invalid: [
			{
				code: 'function first() {}\nfunction second() {}',
				options: [1],
				errors: [{ messageId: 'exceeded', data: { count: 2, max: 1 } }],
			},
			{
				code: 'export const first = () => {}, second = (() => {}) as () => void;',
				options: [1],
				errors: [{ messageId: 'exceeded', data: { count: 2, max: 1 } }],
			},
		],
	});
});
