import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Where `pnpm reports:pull` copies the bucket, ignored by Git. */
const PULLED_LAYOUT_REPORTS = resolve('layout-reports');

export interface PulledFile {
	/** Relative to the pulled directory, as the bucket keys it. */
	readonly path: string;
	/** The parsed JSON, or `undefined` when the file is not JSON. */
	readonly content: unknown;
}

function parseJson(source: string): unknown {
	try {
		return JSON.parse(source);
	} catch {
		return undefined;
	}
}

async function jsonFiles(root: string): Promise<readonly string[]> {
	try {
		const entries = await readdir(root, { recursive: true, withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
			.map((entry) => join(entry.parentPath, entry.name));
	} catch {
		return [];
	}
}

/** Every pulled JSON file, in path order; nothing before the first pull. */
export async function readPulledFiles(
	root = PULLED_LAYOUT_REPORTS,
): Promise<readonly PulledFile[]> {
	const files = await jsonFiles(root);
	const read = await Promise.all(
		files.map(async (file) => ({
			path: relative(root, file),
			content: parseJson(await readFile(file, 'utf8')),
		})),
	);
	return read.sort((left, right) => left.path.localeCompare(right.path));
}
