// Copies the stored layout reports into `layout-reports/`, ignored by Git, for `/atelier/reports`.
// Reads the deployed bucket through Wrangler's login; `--local` reads the bucket `pnpm preview`
// writes to. Objects are never rewritten, so a report already pulled is skipped.
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { getPlatformProxy, unstable_readConfig } from 'wrangler';

const CONFIG = 'config/wrangler.jsonc';
const BINDING = 'LAYOUT_REPORTS';
const PREFIX = 'layout-reports/';
/** Where `pnpm preview` keeps its local bindings: beside its configuration file. */
const PREVIEW_STATE = 'config/.wrangler/state/v3';

const { values } = parseArgs({ options: { local: { type: 'boolean', default: false } } });

const config = unstable_readConfig({ config: CONFIG });
const bucket = config.r2_buckets.find(({ binding }) => binding === BINDING);
if (bucket === undefined) throw new Error(`${CONFIG} declares no ${BINDING} bucket`);

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function listKeys(reports) {
	const keys = [];
	let cursor;
	do {
		const page = await reports.list({ prefix: PREFIX, cursor });
		keys.push(...page.objects.map(({ key }) => key));
		cursor = undefined;
		if (page.truncated) cursor = page.cursor;
	} while (cursor !== undefined);
	return keys;
}

// Only the bucket binding, so that pulling needs neither a build nor the other services.
const directory = await mkdtemp(join(tmpdir(), 'sequit-reports-'));
const configPath = join(directory, 'wrangler.json');
await writeFile(
	configPath,
	JSON.stringify({
		name: 'sequit-layout-reports-pull',
		compatibility_date: config.compatibility_date,
		r2_buckets: [{ binding: BINDING, bucket_name: bucket.bucket_name, remote: !values.local }],
	}),
);
const proxy = await getPlatformProxy({ configPath, persist: { path: resolve(PREVIEW_STATE) } });
try {
	const reports = proxy.env[BINDING];
	const keys = await listKeys(reports);
	let pulled = 0;
	for (const key of keys) {
		const path = resolve(key);
		if (await exists(path)) continue;
		const object = await reports.get(key);
		if (object === null) continue;
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, await object.text());
		pulled += 1;
	}
	let source = 'remote';
	if (values.local) source = 'local';
	process.stdout.write(`${pulled} new of ${keys.length} reports from the ${source} bucket\n`);
} finally {
	await proxy.dispose();
	await rm(directory, { recursive: true, force: true });
}
