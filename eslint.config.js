import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import sonarjs from 'eslint-plugin-sonarjs';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

import localRules from './eslint-rules/index.js';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,svelte}'];
const productionFiles = ['src/lib/**/*.ts', 'workers/collaboration/src/**/*.ts'];

export default defineConfig(
	{
		ignores: [
			'**/.svelte-kit/**',
			'**/.wrangler/**',
			'**/*.d.ts',
			'build/**',
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
						'vitest.config.ts',
						'workers/*/vitest.config.ts',
					],
				},
			},
		},
		plugins: {
			'simple-import-sort': simpleImportSort,
		},
		rules: {
			'default-case-last': 'error',
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
			'@typescript-eslint/no-import-type-side-effects': 'error',
			'@typescript-eslint/prefer-readonly': 'error',
			'@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
			'@typescript-eslint/switch-exhaustiveness-check': 'error',
		},
	},
	{
		files: productionFiles,
		plugins: {
			local: localRules,
			sonarjs,
		},
		rules: {
			complexity: ['error', 20],
			'local/max-top-level-functions': ['error', 15],
			'max-depth': ['error', 4],
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
		files: ['src/lib/text/map-sequit-document.ts'],
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
		files: ['src/lib/layout/dedicated-layout-engine.ts'],
		rules: {
			complexity: ['error', 38],
			'max-statements': ['error', 100],
			'sonarjs/cognitive-complexity': ['error', 68],
		},
	},
	{
		files: ['src/lib/layout/component-layout.ts'],
		rules: {
			complexity: ['error', 23],
			'sonarjs/cognitive-complexity': ['error', 18],
		},
	},
	{
		files: ['src/lib/collaboration/yjs-live-document.ts'],
		rules: {
			'local/max-top-level-functions': ['error', 16],
			'max-params': ['error', 5],
		},
	},
	{
		files: ['src/lib/document/validate-logic-document.ts'],
		rules: {
			'sonarjs/cognitive-complexity': ['error', 23],
		},
	},
	{
		files: ['src/lib/graph/create-graph.ts'],
		rules: {
			'sonarjs/cognitive-complexity': ['error', 16],
		},
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
			},
		},
	},
	{
		files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
		...ts.configs.disableTypeChecked,
	},
	...svelte.configs.prettier,
	prettier,
);
