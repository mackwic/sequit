import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../eslint-rules/prefer-native-string-enum.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('prefer-native-string-enum', () => {
	ruleTester.run('prefer-native-string-enum', rule, {
		valid: [
			"enum OutcomeKind { Accepted = 'accepted', Rejected = 'rejected' }",
			"const YJS_COLLECTIONS = { meta: 'sequit.meta', nodes: 'sequit.nodes' } as const;",
			"const SINGLE_VALUE = { Accepted: 'accepted' } as const; type Value = typeof SINGLE_VALUE[keyof typeof SINGLE_VALUE];",
			"const Domain = { A: 'a', B: 'b' }; { const Domain = { Accepted: 'accepted', Rejected: 'rejected' } as const; } type DomainValue = typeof Domain[keyof typeof Domain];",
		],
		invalid: [
			{
				code: "const OutcomeKind = { Accepted: 'accepted', Rejected: 'rejected' } as const; type OutcomeKind = typeof OutcomeKind[keyof typeof OutcomeKind];",
				errors: [{ messageId: 'closedStringDomain' }],
			},
			{
				code: "export const OutcomeKind = { Accepted: 'accepted', Rejected: 'rejected' } as const; export type OutcomeKind = typeof OutcomeKind[keyof typeof OutcomeKind];",
				errors: [{ messageId: 'closedStringDomain' }],
			},
			{
				code: "const Status = { Draft: 'draft', Published: 'published' } as const; { const Status = { Open: 'open', Closed: 'closed' } as const; } type StatusValue = typeof Status[keyof typeof Status];",
				errors: [{ messageId: 'closedStringDomain' }],
			},
		],
	});
});
