import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/no-swallowed-visual-assertion.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
const errors = [{ messageId: 'swallowed' }];

tester.run('no-swallowed-visual-assertion', rule, {
	valid: [
		'const scenario = { assert(layout) { check(layout); } };',
		'const scenario = { assert(layout) { try { check(layout); } finally { cleanup(); } } };',
		'const scenario = { assert(layout) { try { check(layout); } catch (error) { throw error; } } };',
		'const scenario = { assert(layout) { try { check(layout); } catch (error) { const detail = message(error); log(detail); throw new Error(detail); } } };',
		'const scenario = { arrange() { try { prepare(); } catch { return fallback(); } } };',
		'function other() { try { check(); } catch {} }',
		'function verify(layout) { try { check(layout); } catch (error) { throw error; } } const scenario = { assert: verify };',
	],
	invalid: [
		{ code: 'const scenario = { assert(layout) { try { check(layout); } catch {} } };', errors },
		{
			code: 'const scenario = { assert: (layout) => { try { check(layout); } catch { return; } } };',
			errors,
		},
		{
			code: 'const scenario = { ["assert"](layout) { try { check(layout); } catch (error) { log(error); } } };',
			errors,
		},
		{
			code: 'const scenario = { assert(layout) { try { check(layout); } catch (error) { if (known(error)) return; throw error; } } };',
			errors,
		},
		{
			code: 'function verify(layout) { try { check(layout); } catch {} } const scenario = { assert: verify };',
			errors,
		},
		{
			code: 'const verify = (layout) => { try { check(layout); } catch {} }; const scenario = { assert: verify };',
			errors,
		},
		{
			code: 'function assert(layout) { try { check(layout); } catch {} } const scenario = { assert };',
			errors,
		},
		{
			code: 'const scenario = { assert(layout) { items.forEach(() => { try { check(layout); } catch {} }); } };',
			errors,
		},
	],
});
