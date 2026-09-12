import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/no-uncontrolled-visual-input.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
tester.run('no-uncontrolled-visual-input', rule, {
	valid: [
		"const now=new Date('2020-01-01');",
		'const time=new Date(0);',
		'function example(Math){Math.random();}',
		"const crypto={randomUUID(){return 'fixed';}};crypto.randomUUID();",
		"import { createHash } from 'node:crypto';createHash('sha256');",
	],
	invalid: [
		{ code: 'Math.random();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'const random=Math.random;random();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'const {random: next}=Math;next();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'Date.now();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'new Date();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: "Date('2020-01-01');", errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'const Clock=Date;new Clock();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'globalThis.crypto.randomUUID();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'crypto.getRandomValues(values);', errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'performance.now();', errors: [{ messageId: 'uncontrolled' }] },
		{ code: "const math=Math;math['random']();", errors: [{ messageId: 'uncontrolled' }] },
		{ code: 'const {now}=Date;now();', errors: [{ messageId: 'uncontrolled' }] },
		{
			code: "import {randomUUID as id} from 'node:crypto';id();",
			errors: [{ messageId: 'uncontrolled' }],
		},
		{
			code: "import * as entropy from 'node:crypto';entropy.randomBytes(10);",
			errors: [{ messageId: 'uncontrolled' }],
		},
		{
			code: "import {webcrypto} from 'node:crypto';webcrypto.randomUUID();",
			errors: [{ messageId: 'uncontrolled' }],
		},
	],
});
