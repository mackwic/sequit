import { RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { describe, it } from 'vitest';

import rule from '../../../../config/eslint/rules/forward-visual-layout-configuration.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
tester.run('forward-visual-layout-configuration', rule, {
	valid: [
		"import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){return run({direction,bias});}};",
		"import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(d='down',b){const direction=d; const opts={...fixture,direction,bias:b};return run(opts);}};",
		"import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(d,b){const config={direction:d,bias:b};return run({...fixture,...config});}};",
		"import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={async arrange(d,b){const before=await run({direction:d,bias:b});return run({direction:d,bias:b});}};",
		'function run(options){} const scenario={arrange(d,b){return run({});}};',
	],
	invalid: [
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){return run({direction});}};",
			errors: [{ messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){return run({direction:'down',bias});}};",
			errors: [{ messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){return run({direction,bias,...fixture});}};",
			errors: [{ messageId: 'forward' }, { messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){return run({direction,bias:undefined});}};",
			errors: [{ messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){function wrong(direction){return run({direction,bias});}return wrong('down');}};",
			errors: [{ messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={arrange(direction,bias){const config=config;return run(config);}};",
			errors: [{ messageId: 'forward' }, { messageId: 'forward' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={assert(layout){run({});}};",
			errors: [{ messageId: 'phase' }],
		},
		{
			code: "import { layoutNodes as run } from '../harnesses/layout-nodes'; const scenario={async arrange(d,b){await run({direction:d,bias:b});return run({direction:d});}};",
			errors: [{ messageId: 'forward' }],
		},
		{
			code: "import * as harness from '../harnesses/layout-nodes'; const scenario={arrange(d,b){return harness.layoutNodes({});}};",
			errors: [{ messageId: 'forward' }, { messageId: 'forward' }],
		},
	],
});
