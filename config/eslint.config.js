import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sonarjs from 'eslint-plugin-sonarjs';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

import localRules from './eslint/rules/index.js';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,svelte}'];
const productionFiles = [
	'src/lib/**/*.ts',
	'src/app/web/**/*.ts',
	'src/app/workshop/fixtures/**/*.ts',
	'src/workers/**/*.ts',
];

export default defineConfig(
	{
		ignores: [
			'**/.svelte-kit/**',
			'**/.stryker-tmp/**',
			'**/.wrangler/**',
			'**/*.d.ts',
			'build/**',
			'coverage/**',
			'dist/**',
			'node_modules/**',
			'playwright-report/**',
			'test-results/**',
			'static/**',
		],
	},
	js.configs.recommended,
	...ts.configs.strictTypeChecked,
	...ts.configs.stylisticTypeChecked,
	...svelte.configs.recommended,
	{
		files: sourceFiles,
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				projectService: {
					allowDefaultProject: [
						'playwright.config.ts',
						'vitest.performance.config.ts',
						'vitest.config.ts',
						'production-boundaries.ts',
						'../src/workers/*/vitest.config.ts',
					],
				},
			},
		},
		plugins: {
			'simple-import-sort': simpleImportSort,
		},
		rules: {
			'default-case-last': 'error',
			'default-case': 'error',
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'logical-assignment-operators': ['error', 'always'],
			'no-console': 'error',
			'no-else-return': ['error', { allowElseIf: false }],
			'no-implicit-coercion': 'error',
			'no-lonely-if': 'error',
			'no-param-reassign': 'error',
			'no-ternary': 'error',
			'object-shorthand': ['error', 'always'],
			'operator-assignment': ['error', 'always'],
			'prefer-object-has-own': 'error',
			'prefer-template': 'error',
			'simple-import-sort/exports': 'error',
			'simple-import-sort/imports': 'error',
			yoda: 'error',
			'@typescript-eslint/consistent-type-exports': 'error',
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ disallowTypeAnnotations: true, fixStyle: 'inline-type-imports' },
			],
			'@typescript-eslint/explicit-module-boundary-types': 'error',
			'@typescript-eslint/no-import-type-side-effects': 'error',
			'@typescript-eslint/no-unsafe-type-assertion': 'error',
			'@typescript-eslint/prefer-readonly': 'error',
			'@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
			'@typescript-eslint/strict-boolean-expressions': 'error',
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
		},
	},
	{
		files: ['*.ts'],
		rules: {
			'@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
		},
	},
	{
		files: ['src/**/*.{ts,js,svelte}'],
		plugins: { local: localRules },
		rules: { 'local/allowed-import-directions': 'error' },
	},
	{
		files: productionFiles,
		ignores: ['src/workers/**/vitest.config.ts'],
		plugins: {
			local: localRules,
			sonarjs,
		},
		rules: {
			complexity: ['error', 20],
			'local/max-body-nesting': ['error', 4],
			'local/max-operators-per-expression': ['error', 3],
			'local/max-top-level-functions': ['error', 15],
			'local/no-anonymous-object-union-members': 'error',
			'local/prefer-native-string-enum': 'error',
			'local/prefer-string-enum': 'error',
			'max-lines': ['error', { max: 325, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': [
				'error',
				{ max: 160, skipBlankLines: true, skipComments: true, IIFEs: true },
			],
			'max-params': ['error', 4],
			'max-statements': ['error', 40],
			'sonarjs/cognitive-complexity': ['error', 15],
			'sonarjs/no-all-duplicated-branches': 'error',
			'sonarjs/no-duplicated-branches': 'error',
			'sonarjs/no-gratuitous-expressions': 'error',
			'sonarjs/no-identical-conditions': 'error',
			'sonarjs/no-identical-expressions': 'error',
			'sonarjs/operation-returning-nan': 'error',
		},
	},
	{
		files: ['src/lib/core/**/*.ts'],
		rules: {
			'no-restricted-globals': [
				'error',
				'window',
				'document',
				'fetch',
				'WebSocket',
				'localStorage',
				'sessionStorage',
				'crypto',
				'Date',
				'performance',
				'setTimeout',
				'setInterval',
			],
			'no-restricted-properties': [
				'error',
				{
					object: 'Math',
					property: 'random',
					message: 'Pass deterministic inputs into core operations.',
				},
			],
		},
	},
	{
		files: ['src/lib/infrastructure/toml/map-sequit-document.ts'],
		rules: {
			complexity: ['error', 48],
			'max-lines-per-function': [
				'error',
				{ max: 162, skipBlankLines: true, skipComments: true, IIFEs: true },
			],
			'max-statements': ['error', 89],
			'sonarjs/cognitive-complexity': ['error', 83],
		},
	},
	{
		files: ['src/lib/core/layout/dedicated-layout-engine.ts'],
		rules: {
			complexity: ['error', 38],
			'max-lines': ['error', { max: 337, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': [
				'error',
				{ max: 176, skipBlankLines: true, skipComments: true, IIFEs: true },
			],
			'max-statements': ['error', 101],
			'no-ternary': 'off',
			'sonarjs/cognitive-complexity': ['error', 68],
		},
	},
	{
		files: ['src/lib/core/layout/component-layout.ts'],
		rules: {
			complexity: ['error', 32],
			'max-params': ['error', 7],
			'no-ternary': 'off',
			'sonarjs/cognitive-complexity': ['error', 32],
		},
	},
	{
		files: ['src/lib/infrastructure/collaboration/yjs-live-document.ts'],
		rules: {
			'local/max-top-level-functions': ['error', 16],
			'max-params': ['error', 5],
		},
	},
	{
		files: ['src/lib/core/document/validate-logic-document.ts'],
		rules: {
			'sonarjs/cognitive-complexity': ['error', 23],
		},
	},
	{
		files: ['src/lib/core/graph/create-graph.ts'],
		rules: {
			complexity: ['error', 24],
			'max-statements': ['error', 52],
			'no-ternary': 'off',
			'sonarjs/cognitive-complexity': ['error', 30],
		},
	},
	{
		files: ['src/lib/core/graph/topological-ranks.ts'],
		rules: {
			'no-ternary': 'off',
			'sonarjs/cognitive-complexity': ['error', 19],
		},
	},
	{
		files: [
			'src/app/web/ui/canvas/render-relations.ts',
			'src/app/web/ui/components/canvas/LogicCanvas.svelte',
			'tests/app/web/ui/canvas/canvas-model.test.ts',
			'tests/lib/infrastructure/collaboration/yjs-live-document.test.ts',
			'tests/lib/core/graph/logic-graph.test.ts',
			'tests/app/web/projection/layout-graph.test.ts',
		],
		rules: {
			'no-ternary': 'off',
		},
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
		rules: {
			'svelte/button-has-type': 'error',
			'svelte/no-ignored-unsubscribe': 'error',
			'svelte/no-target-blank': 'error',
			'svelte/no-top-level-browser-globals': 'error',
			'svelte/prefer-const': 'error',
			'svelte/require-optimized-style-attribute': 'error',
		},
	},
	{
		files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
		...ts.configs.disableTypeChecked,
		rules: {
			...ts.configs.disableTypeChecked.rules,
			'@typescript-eslint/explicit-module-boundary-types': 'off',
		},
	},
	...svelte.configs.prettier,
	prettier,
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: ts.parser,
		},
	},
);
