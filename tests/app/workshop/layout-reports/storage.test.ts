import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPulledFiles } from '../../../../src/app/workshop/layout-reports/storage';

let root: string | undefined;

afterEach(async () => {
	if (root !== undefined) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe('pulled report files', () => {
	it('reads every JSON file below the pulled directory, by bucket path', async () => {
		root = await mkdtemp(join(tmpdir(), 'sequit-pulled-'));
		await mkdir(join(root, '2026-10-02'));
		await writeFile(join(root, '2026-10-02', 'b.json'), '{"id":"b"}');
		await writeFile(join(root, '2026-10-02', 'a.json'), 'not json');
		await writeFile(join(root, '2026-10-02', 'notes.txt'), 'ignored');
		expect(await readPulledFiles(root)).toEqual([
			{ path: join('2026-10-02', 'a.json'), content: undefined },
			{ path: join('2026-10-02', 'b.json'), content: { id: 'b' } },
		]);
	});

	it('reads nothing before the first pull', async () => {
		expect(await readPulledFiles(join(tmpdir(), 'sequit-never-pulled'))).toEqual([]);
	});
});
