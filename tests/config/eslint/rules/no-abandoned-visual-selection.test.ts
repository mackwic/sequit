import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/no-abandoned-visual-selection.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
const setup =
	"import { AssertLayout as verify } from '../../../support/assertions/assert-layout'; const check = verify(layout);";
const errors = [{ messageId: 'abandoned' }];

tester.run('no-abandoned-visual-selection', rule, {
	valid: [
		`${setup} check.nodes(['a', 'b']).haveRank(2).areAfter('root');`,
		`${setup} const selected = check.node('a'); selected.hasRank(1);`,
		`${setup} const selected = check.routes(); consume(selected);`,
		`${setup} function select() { return check.node('a'); }`,
		`${setup} check.routes().haveNoOverlap().haveNoCrossing();`,
		`${setup} function other(check) { check.node('a'); }`,
		"import { AssertLayout } from './unrelated'; AssertLayout(layout).node('a');",
		"const check = { node(id) { save(id); } }; check.node('a');",
		`${setup} const same = same; same.node('a');`,
	],
	invalid: [
		...[
			'node',
			'nodes',
			'envelope',
			'route',
			'routes',
			'renderedPaths',
			'ports',
			'rails',
			'trunks',
		].map((selection) => ({
			code: `${setup} check.${selection}('a');`,
			errors,
		})),
		{ code: `${setup} verify(layout);`, errors },
		{ code: `${setup} verify(layout).node('a');`, errors },
		{ code: `${setup} const alias = check; alias['routes']();`, errors },
		{ code: `${setup} const selected = check.node('a'); selected;`, errors },
		{ code: `${setup} (check as Checks).node('a');`, errors },
		{ code: `${setup} check?.routes();`, errors },
		{
			code: "import * as assertions from './assert-layout.ts'; assertions.AssertLayout(layout).routes();",
			errors,
		},
		{ code: `${setup} const factory = verify; factory(layout).node('a');`, errors },
	],
});
