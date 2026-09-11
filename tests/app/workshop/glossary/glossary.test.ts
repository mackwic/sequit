import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
	glossarySections,
	readGlossary,
	writeGlossary,
} from '../../../../src/app/workshop/glossary/glossary';

const source =
	'# Lexique\n\n## 1. Atomes\n\n| VL-101 | Point | Point | Position | todo | |\n\nNotes libres conservées.\n';

describe('editable glossary', () => {
	it('round-trips the editable working document', async () => {
		const document = await readFile('docs/visual-language.md', 'utf8');
		const entries = readGlossary(document);
		expect(readGlossary(writeGlossary(document, entries))).toEqual(entries);
	});
	it('preserves surrounding prose and round-trips discussion characters', () => {
		const entries = readGlossary(source);
		const first = entries[0];
		if (first === undefined) throw new Error('Missing fixture');
		first.notes = 'Thomas : A | B\n<question> & &#124;';
		first.status = 'ok';
		const result = writeGlossary(source, entries);
		expect(result).toContain('Notes libres conservées.');
		expect(readGlossary(result)).toEqual(entries);
	});
	it('adds, removes, moves and restores terms including an empty family', () => {
		const document = `${source.replace(
			'| VL-101',
			'| ID | Français | English | Définition | Décision | Remarques |\n| --- | --- | --- | --- | --- | --- |\n| VL-101',
		)}\n## 2. Routes\n| ID | Français | English | Définition | Décision | Remarques |\n| --- | --- | --- | --- | --- | --- |\n`;
		const initial = readGlossary(document);
		const entry = initial[0];
		if (entry === undefined) throw new Error('Missing entry');
		const added = { ...entry, id: 'VL-new', section: '2. Routes', fr: 'Rail' };
		const updated = writeGlossary(document, [...initial, added]);
		expect(readGlossary(updated)).toEqual([...initial, added]);
		const empty = writeGlossary(updated, []);
		expect(readGlossary(empty)).toEqual([]);
		expect(glossarySections(empty)).toEqual(['1. Atomes', '2. Routes']);
		expect(readGlossary(writeGlossary(empty, [added]))).toEqual([added]);
		expect(() => writeGlossary(document, [entry, entry])).toThrow();
		expect(writeGlossary(updated, [{ ...entry, section: '2. Routes' }])).toContain(
			'Notes libres conservées.',
		);
	});

	it('rejects missing, duplicate and malformed terms', () => {
		expect(() => readGlossary('')).toThrow();
		expect(() => readGlossary(`${source}${source}`)).toThrow();
		expect(() => readGlossary('| VL-1 | bad |')).toThrow();
		expect(writeGlossary(source, [])).not.toContain('VL-101');
		const entries = readGlossary(source).map((entry) => ({ ...entry, section: 'Unknown' }));
		expect(() => writeGlossary(source, entries)).toThrow();
	});
});
