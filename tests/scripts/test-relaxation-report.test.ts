import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/test-relaxation-report.mjs');

it('reports assertion removals, disabled tests and changed budget ceilings across commits', () => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'sequit-relaxation-'));
	const git = (...args: string[]) => {
		const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
		if (result.status !== 0) throw new Error(result.stderr);
	};
	try {
		git('init', '-q');
		git('config', 'user.email', 'test@example.invalid');
		git('config', 'user.name', 'Test');
		writeFileSync(
			resolve(cwd, 'check.test.ts'),
			'expect(value).toBe(1);\nconst SEARCH_BUDGET = 64;\nconst maxMilliseconds = 150;\n',
		);
		git('add', '.');
		git('commit', '-qm', 'base');
		git('branch', 'base');
		writeFileSync(
			resolve(cwd, 'check.test.ts'),
			"it.fails('regression', () => {});\nit.skip('later', () => {});\nconst SEARCH_BUDGET = 32;\nconst maxMilliseconds = 170;\n",
		);
		git('add', '.');
		git('commit', '-qm', 'changed');
		const result = spawnSync(process.execPath, [script, 'base'], { cwd, encoding: 'utf8' });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('expect supprimé check.test.ts:1');
		expect(result.stdout).toContain('test neutralisé check.test.ts:1');
		expect(result.stdout).toContain('test neutralisé check.test.ts:2');
		expect(result.stdout).toContain('SEARCH_BUDGET 64 → 32');
		expect(result.stdout).toContain('maxMilliseconds 150 → 170');
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
