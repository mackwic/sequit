import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { error } from '@sveltejs/kit';

import { readGlossary } from './glossary';

const path = resolve('docs/visual-language.md');
let pending = Promise.resolve();

export async function readDocument(): Promise<string> {
	return readFile(path, 'utf8');
}

export async function saveDocument(base: string, document: string): Promise<void> {
	const operation = pending.then(async () => {
		const current = await readDocument();
		if (current !== base)
			error(409, 'Le fichier a changé. Recharge la page après avoir copié tes modifications.');
		try {
			readGlossary(document);
		} catch {
			error(400, 'Document de lexique invalide.');
		}
		const temporary = `${path}.tmp`;
		await writeFile(temporary, document, 'utf8');
		await rename(temporary, path);
	});
	pending = operation.catch(() => undefined);
	await operation;
}
