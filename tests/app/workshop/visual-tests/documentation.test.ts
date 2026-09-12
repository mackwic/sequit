import { globSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readGlossary } from '../../../../src/app/workshop/glossary/glossary';

const documents = globSync('tests/scenarios/visual/**/*.svx').sort();
const glossaryIds = new Set(
	readGlossary(readFileSync('docs/visual-language.md', 'utf8')).map(({ id }) => id),
);

describe('visual scenario documentation', () => {
	it('discovers the scenario documents', () => {
		expect(documents.length).toBeGreaterThan(0);
	});
	it.each(documents)('%s links only to existing glossary anchors', (file) => {
		// Read literal URLs as text: no Markdown compiler, component or browser is loaded.
		const links = readFileSync(file, 'utf8').match(/\/atelier\/lexique#[^\s)"'<>]+/g) ?? [];
		for (const link of links) {
			const id = decodeURIComponent(new URL(link, 'https://sequit.test').hash.slice(1));
			expect(glossaryIds, `${file}: unknown glossary anchor in ${link}`).toContain(id);
		}
	});
});
