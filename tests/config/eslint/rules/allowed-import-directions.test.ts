import path from 'node:path';

import { ESLint, RuleTester } from 'eslint';
import ts from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import rule from '../../../../config/eslint/rules/allowed-import-directions.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: ts.parser } });
const filename = (file: string): string => path.resolve(file);
const core = filename('src/lib/core/example.ts');
const web = filename('src/app/web/example.ts');
const workshop = filename('src/app/workshop/example.ts');
const worker = filename('src/workers/collaboration-worker/example.ts');
const infra = filename('src/lib/infrastructure/example.ts');
const errors = [{ messageId: 'forbidden' }];

describe('repository ESLint configuration', () => {
	const eslint = new ESLint();
	const filePath = filename('src/app/web/ui/components/canvas/LogicCanvas.svelte');

	beforeAll(async () => {
		// Load the repository config and plugins as setup, outside the behavior test's budget.
		await eslint.calculateConfigForFile(filePath);
	});

	it('enforces the shared policy in Svelte', async () => {
		const results = await eslint.lintText(
			'<script lang="ts">import Workshop from "/src/app/workshop/WorkshopPage.svelte";</script>',
			{ filePath },
		);
		expect(results.flatMap((result) => result.messages)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ruleId: 'local/allowed-import-directions', severity: 2 }),
			]),
		);
	});
});

tester.run('allowed-import-directions', rule, {
	valid: [
		{ filename: core, code: "import { generateKeyBetween } from 'fractional-indexing';" },
		{
			filename: core,
			code: "import type { LogicDocument } from '$lib/core/document/logic-document';",
		},
		{ filename: infra, code: "import { defined } from '../core/document/logic-document';" },
		{
			filename: web,
			code: "import { parseSequitToml } from '$lib/infrastructure/toml/parse-sequit-toml';",
		},
		{ filename: web, code: "import { resolve } from '$app/paths';" },
		{
			filename: workshop,
			code: "import Canvas from '../web/ui/components/canvas/LogicCanvas.svelte';",
		},
		{
			filename: worker,
			code: "import { decodeCollabMessage } from '../../lib/infrastructure/collaboration/protocol';",
		},
		{
			filename: filename('src/lib/core/graph/example.ts'),
			code: "export { defined } from '../document/logic-document';",
		},
	],
	invalid: [
		{ filename: core, code: "import * as Y from 'yjs';", errors },
		{ filename: core, code: "import fs from 'node:fs';", errors },
		{
			filename: core,
			code: "import type { CanvasModel } from '../../app/web/ui/canvas/canvas-model';",
			errors,
		},
		{
			filename: core,
			code: "import { parseSequitToml } from '$lib/core/../infrastructure/toml/parse-sequit-toml';",
			errors,
		},
		{
			filename: infra,
			code: "import { DocumentSession } from '../../app/web/document/document-session';",
			errors,
		},
		{ filename: web, code: "import Workshop from '../workshop/WorkshopPage.svelte';", errors },
		{
			filename: worker,
			code: "import Canvas from '../../app/web/ui/components/canvas/LogicCanvas.svelte';",
			errors,
		},
		{ filename: web, code: "export * from '../workshop/catalogue';", errors },
		{ filename: web, code: "export { workshopGroups } from '../workshop/catalogue';", errors },
		{ filename: web, code: "const page = import('../workshop/WorkshopPage.svelte');", errors },
		{ filename: web, code: 'const page = import(`../workshop/WorkshopPage.svelte`);', errors },
		{ filename: web, code: "const page = require('../workshop/catalogue');", errors },
		{ filename: web, code: "import page = require('../workshop/catalogue');", errors },
		{
			filename: web,
			code: "type Page = import('../workshop/catalogue').WorkshopScenario;",
			errors,
		},
		{ filename: web, code: "import { x } from '/src/app/workshop/catalogue.ts?raw';", errors },
		{
			filename: web,
			code: "import { x } from '../../../tests/support/fixtures/documents';",
			errors,
		},
		{
			filename: filename('src/lib/core/graph/example.ts'),
			code: "import { layoutWithDedicatedEngine } from '../layout/dedicated-layout-engine';",
			errors,
		},
		{
			filename: filename('src/lib/infrastructure/toml/example.ts'),
			code: "import { createGraph } from '../../core/graph/create-graph';",
			errors,
		},
	],
});
