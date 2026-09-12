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
const eslint = new ESLint();
const component = filename('src/app/web/ui/components/canvas/LogicCanvas.svelte');

beforeAll(async () => {
	await eslint.calculateConfigForFile(component);
});

it('enforces the shared policy in Svelte through the repository ESLint configuration', async () => {
	const results = await eslint.lintText(
		'<script lang="ts">import Workshop from "/src/app/workshop/WorkshopPage.svelte";</script>',
		{ filePath: component },
	);
	expect(results.flatMap((result) => result.messages)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ ruleId: 'local/allowed-import-directions', severity: 2 }),
		]),
	);
});

it('enforces visual conventions through the repository configuration', async () => {
	const results = await eslint.lintText(
		`
 import { expect } from 'vitest';
 import { AssertLayout as verify } from '../../../support/assertions/assert-layout';
 export const scenario = {
 assert(layout) { const check = verify(layout); check.node('a'); try { check.routes().haveNoCrossing(); } catch {} }
 };
 `,
		{ filePath: filename('tests/scenarios/visual/routing/default-quays.scenario.ts') },
	);
	expect(results.flatMap((result) => result.messages.map((message) => message.ruleId))).toEqual(
		expect.arrayContaining([
			'local/allowed-import-directions',
			'local/no-abandoned-visual-selection',
			'local/no-swallowed-visual-assertion',
		]),
	);
});

it('activates facade, phase, configuration and deterministic-input guards', async () => {
	const results = await eslint.lintText(
		`
 import { AssertNode } from '../../../support/assertions/assert-node';
 import { AssertLayout as verify } from '../../../support/assertions/assert-layout';
 import { layoutNodes } from '../../../support/harnesses/layout-nodes';
 export const scenario = {
 arrange(direction, bias) { verify(layout).node('a').hasRank(1); Math.random(); return layoutNodes({ direction }); },
 assert(layout) { AssertNode(layout.getNodeById('a')).hasRank(1); }
 };
 `,
		{ filePath: filename('tests/scenarios/visual/nodes/single-node.scenario.ts') },
	);
	expect(results.flatMap((result) => result.messages.map((message) => message.ruleId))).toEqual(
		expect.arrayContaining([
			'no-restricted-imports',
			'local/require-visual-assertion',
			'local/visual-scenario-phases',
			'local/forward-visual-layout-configuration',
			'local/no-uncontrolled-visual-input',
		]),
	);
});

it('allows specialized assertions and generated counterexamples in unit tests', async () => {
	const results = await eslint.lintText(
		`
 import { AssertNode } from './assert-node';
 const rank = Math.random();
 AssertNode(node).hasRank(rank);
 `,
		{ filePath: filename('tests/support/assertions/assert-layout.test.ts') },
	);
	const ids = results.flatMap((result) => result.messages.map((message) => message.ruleId));
	expect(ids).not.toContain('no-restricted-imports');
	expect(ids).not.toContain('local/require-visual-assertion');
	expect(ids).not.toContain('local/no-uncontrolled-visual-input');
});

it('keeps scenario-only rules out of assertion counterexample tests', async () => {
	const config: unknown = await eslint.calculateConfigForFile(
		filename('tests/support/assertions/assert-layout.test.ts'),
	);
	expect(config).toHaveProperty('rules');
	expect(config).not.toHaveProperty(['rules', 'local/no-abandoned-visual-selection']);
	expect(config).not.toHaveProperty(['rules', 'local/no-swallowed-visual-assertion']);
});

tester.run('allowed-import-directions', rule, {
	valid: [
		{
			filename: filename('tests/support/scenarios/collaboration.ts'),
			code: "import { expect } from 'vitest';",
		},
		{
			filename: filename('tests/support/assertions/assert-layout.test.ts'),
			code: "import { expect } from 'vitest';",
		},
		{
			filename: filename('tests/scenarios/visual/scenarios.test.ts'),
			code: "import { expect } from 'vitest';",
		},
		{
			filename: filename('tests/scenarios/visual/routing/default-quays.scenario.ts'),
			code: "import { AssertLayout } from '../../../support/assertions/assert-layout';",
		},
		{
			filename: filename('tests/support/assertions/assert-layout-routing.ts'),
			code: "import { renderRelationPaths } from '../../../src/app/web/ui/canvas/render-relations';",
		},

		{
			filename: filename('src/app/workshop/visual-tests/ScenarioGallery.svelte'),
			code: "import { catalogue } from '../../../../tests/scenarios/visual/catalogue';",
		},
		{
			filename: filename('src/app/workshop/visual-tests/example.ts'),
			code: "import { AssertBox } from '../../../../tests/support/assertions/assert-box';",
		},
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
		...[
			'../../../../src/lib/core/graph/create-graph',
			'../../../../src/app/web/projection/layout-graph',
			'../../../../src/app/web/ui/canvas/render-relations',
			'../../../support/assertions/assert-layout-routing',
		].map((source) => ({
			filename: filename('tests/scenarios/visual/nodes/single-node.scenario.ts'),
			code: `import * as bypass from '${source}';`,
			errors,
		})),
		...[
			'vitest',
			'vitest/config',
			'@vitest/expect',
			'@playwright/test',
			'playwright',
			'playwright-core',
		].map((runner) => ({
			filename: filename('tests/scenarios/visual/routing/default-quays.scenario.ts'),
			code: `import runner from '${runner}';`,
			errors,
		})),
		{
			filename: filename('tests/support/assertions/example.ts'),
			code: "export { expect } from 'vitest';",
			errors,
		},
		{
			filename: filename('tests/support/fixtures/example.ts'),
			code: "const runner = import('@playwright/test');",
			errors,
		},
		{
			filename: filename('tests/support/builders/example.ts'),
			code: "import '../assertions/assert-layout.test';",
			errors,
		},
		{
			filename: filename('tests/support/harnesses/example.ts'),
			code: "import Canvas from '../../../src/app/web/ui/components/canvas/LogicCanvas.svelte';",
			errors,
		},

		{
			filename: workshop,
			code: "import { graphFixtures } from '../../../tests/support/fixtures/graph-fixtures';",
			errors,
		},
		{
			filename: core,
			code: "import { graphFixtures } from '../../../tests/support/fixtures/graph-fixtures';",
			errors,
		},
		{
			filename: worker,
			code: "import { catalogue } from '../../../tests/scenarios/visual/catalogue';",
			errors,
		},
		{
			filename: filename('src/app/workshop/visual-tests/example.ts'),
			code: "import '../../../../tests/scenarios/visual/scenarios.test';",
			errors,
		},
		{
			filename: filename('src/app/workshop/visual-tests/example.ts'),
			code: "import '../../../../tests/app/workshop/visual-tests/directions.test';",
			errors,
		},
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
			code: "import { layoutWithDedicatedEngine } from '../layout/layout-engine';",
			errors,
		},
		{
			filename: filename('src/lib/infrastructure/toml/example.ts'),
			code: "import { createGraph } from '../../core/graph/create-graph';",
			errors,
		},
	],
});

tester.run('layout phase boundaries', rule, {
	valid: [
		{
			filename: filename('src/lib/core/layout/layout-engine.ts'),
			code: "import type { LayoutWorkspace } from './layout-workspace';",
		},
		{
			filename: filename('src/lib/core/layout/placement/place-component.ts'),
			code: "import { transverseEnvelope } from '../geometry/envelope';",
		},
		{
			filename: filename('src/lib/core/layout/routing/quay-allocation.ts'),
			code: "import { transverseCenter } from '../geometry/layout-frame';",
		},
		{
			filename: filename('src/lib/core/layout/structure/prepare-layout.ts'),
			code: "import { orderEndpoints } from '../../ordering/endpoint-order';",
		},
	],
	invalid: [
		{
			filename: filename('src/lib/core/layout/geometry/envelope.ts'),
			code: "import { placeElements } from '../placement/place-elements';",
			errors,
		},
		{
			filename: filename('src/lib/core/layout/structure/prepare-layout.ts'),
			code: "import type { NodeRouting } from '../routing/reserve-node-routing';",
			errors,
		},
		{
			filename: filename('src/lib/core/layout/placement/place-component.ts'),
			code: "import { planNodeRouting } from '../routing/reserve-node-routing';",
			errors,
		},
		{
			filename: filename('src/lib/core/layout/routing/quay-allocation.ts'),
			code: "import { placeElements } from '../placement/place-elements';",
			errors,
		},
		{
			filename: filename('src/lib/core/layout/inspection/routing-inspection.ts'),
			code: "import { layoutWithDedicatedEngine } from '../layout-engine';",
			errors,
		},
		{
			filename: filename('src/lib/core/layout/build-layout-result.ts'),
			code: "import type { LayoutWorkspace } from './layout-workspace';",
			errors,
		},
	],
});
