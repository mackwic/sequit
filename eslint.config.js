import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,svelte}'];

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
						'vitest.performance.config.ts',
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
