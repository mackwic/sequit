import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint-rules/prefer-string-enum.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('prefer-string-enum', () => {
	ruleTester.run('prefer-string-enum', rule, {
		valid: [
			"enum OutcomeKind { Accepted = 'accepted', Rejected = 'rejected' } const outcome: OutcomeKind.Rejected = OutcomeKind.Rejected;",
			"const outcome = 'rejected' as const;",
			'type RetryCount = 0 | 1; type Enabled = true | false;',
			'type EventName = `document:${string}`;',
			"interface Diagnostic { readonly code: string } type Code = Diagnostic['code'];",
		],
		invalid: [
			{
				code: "const outcome: 'rejected' = 'rejected';",
				errors: [{ messageId: 'stringLiteralType' }],
			},
			{
				code: "type OutcomeKind = 'accepted' | 'rejected';",
				errors: [{ messageId: 'stringLiteralType' }, { messageId: 'stringLiteralType' }],
			},
			{
				code: "interface RejectedOutcome { readonly kind: 'rejected' }",
				errors: [{ messageId: 'stringLiteralType' }],
			},
			{
				code: "type Pending = Exclude<Outcome, { readonly kind: 'accepted' }>;",
				errors: [{ messageId: 'stringLiteralType' }],
			},
		],
	});
});
