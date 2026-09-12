import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/visual-scenario-phases.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
tester.run('visual-scenario-phases', rule, {
	valid: [
		'const scenario={assert(layout){const unrelated={withElements(){return 1;}};unrelated.withElements();}};',
		"import { layoutNodes as run } from '../harnesses/layout-nodes'; import { graphFixtures as data } from '../fixtures/graph-fixtures'; const scenario={arrange(direction,bias){return run({...data.twoSuccessors().build(),direction,bias});}};",
		"import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario={assert(layout){verify(layout).node('a').hasRank(1); layout.envelopeOf(['a']);}};",
		"import { extent } from '../assertions/routing-measurements'; const scenario={assert(layout){extent(layout.frame.bounds,'x');}};",
		'const scenario={assert(layout){const data={build(){return 1;}};data.build();}};',
	],
	invalid: [
		{
			code: "const scenario={assert(layout){const copy=layout;copy.withElements([]).getById('a');}};",
			errors: [{ messageId: 'geometry' }],
		},
		{
			code: "import { AssertLayout as verify } from '../assertions/assert-layout'; const scenario={arrange(layout){verify(layout).node('a').hasRank(1);}};",
			errors: [{ messageId: 'verify' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={assert(layout){run({direction:layout.direction});}};",
			errors: [{ messageId: 'prepare' }],
		},
		{
			code: "import { graphFixtures as data } from '../fixtures/graph-fixtures'; const scenario={assert(layout){data.twoSuccessors();}};",
			errors: [{ messageId: 'prepare' }],
		},
		{
			code: "import { equalMetric } from '../assertions/routing-measurements'; const scenario={arrange(){equalMetric('x',1,1);}};",
			errors: [{ messageId: 'verify' }],
		},
		{
			code: "import { VisualLayout as Result } from '../harnesses/visual-layout'; const scenario={arrange(){return new Result({});}};",
			errors: [{ messageId: 'geometry' }],
		},
		{
			code: 'const scenario={assert(layout){layout.withElements([]);}};',
			errors: [{ messageId: 'geometry' }],
		},
		{
			code: "import { graphFixtures as data } from '../fixtures/graph-fixtures'; const prepare=()=>{data.twoSuccessors();}; const scenario={assert:prepare};",
			errors: [{ messageId: 'prepare' }],
		},
	],
});
