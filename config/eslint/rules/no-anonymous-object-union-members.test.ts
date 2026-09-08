import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from './no-anonymous-object-union-members.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
	languageOptions: {
		parser: ts.parser,
		parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
	},
});

describe('no-anonymous-object-union-members', () => {
	ruleTester.run('no-anonymous-object-union-members', rule, {
		valid: [
			"type Accepted = { readonly kind: 'accepted' }; type Rejected = { readonly kind: 'rejected'; readonly reason: string }; type Outcome = Accepted | Rejected;",
			"interface Accepted { readonly kind: 'accepted' } interface Rejected { readonly kind: 'rejected' } type Outcome = Accepted | Rejected;",
			"type State = 'idle' | 'running' | null;",
			'type Box = { readonly value: { readonly nested: string } }; type Result = Box | null;',
			'type Result = Promise<{ readonly value: string }> | null;',
		],
		invalid: [
			{
				code: "type Outcome = { readonly kind: 'accepted' } | { readonly kind: 'rejected'; readonly reason: string };",
				errors: [{ messageId: 'anonymousObject' }, { messageId: 'anonymousObject' }],
			},
			{
				code: "type Accepted = { readonly kind: 'accepted' }; type Outcome = Accepted | { readonly kind: 'rejected' };",
				errors: [{ messageId: 'anonymousObject' }],
			},
			{
				code: "type Outcome = ({ readonly kind: 'accepted' }) | null;",
				errors: [{ messageId: 'anonymousObject' }],
			},
			{
				code: `export type DocumentSessionErrorReport =
					| { readonly kind: 'subscriber-error'; readonly error: unknown }
					| {
							readonly kind: 'rejected-external-transaction';
							readonly diagnostics: readonly DocumentCommandDiagnostic[];
					  }
					| {
							readonly kind: 'asynchronous-command-outcome';
							readonly outcome: Exclude<
								DocumentCommandOutcome,
								{ readonly kind: 'accepted' }
							>;
					  };`,
				errors: [
					{ messageId: 'anonymousObject' },
					{ messageId: 'anonymousObject' },
					{ messageId: 'anonymousObject' },
				],
			},
		],
	});
});
