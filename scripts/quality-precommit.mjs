import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function changedFiles(args) {
	const result = spawnSync('git', args, { encoding: 'utf8' });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
	return result.stdout.split('\0').filter(Boolean);
}

const extensions = new Set([
	'.js',
	'.mjs',
	'.cjs',
	'.ts',
	'.svelte',
	'.css',
	'.html',
	'.json',
	'.jsonc',
	'.md',
	'.yaml',
	'.yml',
]);
const files = [
	...new Set([
		...changedFiles(['diff', '--name-only', '-z', '--diff-filter=ACMR', 'HEAD']),
		...changedFiles(['ls-files', '--others', '--exclude-standard', '-z']),
	]),
].filter((file) => existsSync(file) && extensions.has(extname(file)));
if (files.length > 0)
	run('pnpm', [
		'exec',
		'prettier',
		'--config',
		'config/prettier.config.js',
		'--ignore-path',
		'config/prettier.ignore',
		'--write',
		...files,
	]);
const checks = [
	['run', 'quality:unused'],
	['run', 'quality:architecture'],
	['run', 'check:types'],
];
const lintableExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.svelte']);
const lintable = files.filter((file) => lintableExtensions.has(extname(file)));
if (lintable.length > 0)
	checks.unshift(['exec', 'eslint', ...lintable, '--max-warnings', '0', '--no-warn-ignored']);
else checks.unshift(['run', 'lint']);
const results = await Promise.all(
	checks.map(
		(args) =>
			new Promise((resolve, reject) => {
				const child = spawn('pnpm', args, { stdio: 'inherit' });
				child.on('error', reject);
				child.on('close', (code) => resolve(code));
			}),
	),
);
if (results.some((code) => code !== 0)) process.exit(1);
