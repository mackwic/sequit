import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/require-visual-assertion.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
tester.run('require-visual-assertion', rule, {
	valid: [
		"import { AssertLayout } from '../assertions/assert-layout'; const scenario={assert(layout){AssertLayout(layout).document().hasEndpoints([]).hasRelations([]);}};",
		"import { AssertLayout } from '../assertions/assert-layout'; const scenario={assert(layout){AssertLayout(layout).junctions(['j']).areOnSameRail();}};",
		"import { AssertLayout } from '../assertions/assert-layout'; const scenario={assert(layout){AssertLayout(layout).obstacles().haveClearance(12);}};",

		"import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert(layout) { const c=verify(layout); c.node('a').hasRank(1); } };",
		"import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert: layout => verify(layout).routes().haveNoCrossing() };",
		"import { AssertLayout as verify } from '../assertions/assert-layout'; function inspect(layout) { const c = verify(layout); const nodes=c.nodes(['a']); nodes.haveRank(1); } const scenario = { assert: inspect };",
		"import * as checks from '../assertions/assert-layout'; const scenario = { assert(layout) { checks.AssertLayout(layout).route('r').isOrthogonal(); } };",
	],
	invalid: [
		{
			code: "import { AssertLayout } from '../assertions/assert-layout'; const scenario={assert(layout){AssertLayout(layout).junctions(['j']);}};",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout } from '../assertions/assert-layout'; const scenario={assert(layout){AssertLayout(layout).document();}};",
			errors: [{ messageId: 'missing' }],
		},

		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert(layout) {} };",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert(layout) { const c=verify(layout); c.node('a'); } };",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert(layout) { const c=verify(layout); c.node('a').hasRank; } };",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { arrange(layout) { verify(layout).node('a').hasRank(1); }, assert(layout) {} };",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario = { assert(check) { check.node('a').hasRank(1); } };",
			errors: [{ messageId: 'missing' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; verify(layout).node('a').hasRank(1);",
			errors: [{ messageId: 'missing' }],
		},
	],
});
