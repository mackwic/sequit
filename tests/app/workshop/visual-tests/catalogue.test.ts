import { globSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { catalogue } from '../../../../src/app/workshop/visual-tests/catalogue';

const root = 'src/app/workshop/visual-tests/';

describe('visual scenario catalogue', () => {
	it('discovers every scenario and pairs it with exactly one document', () => {
		const sources = globSync(`${root}cases/**/*.scenario.ts`).sort();
		const documents = globSync(`${root}cases/**/*.svx`).sort();
		expect(catalogue.length).toBeGreaterThan(0);
		expect(catalogue.map(({ documentPath }) => root + documentPath.slice(2)).sort()).toEqual(
			documents,
		);
		expect(documents.map((path) => path.replace(/\.svx$/, '.scenario.ts'))).toEqual(sources);
	});
	it('uses unique stable identifiers', () => {
		const ids = catalogue.map(({ scenario }) => scenario.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
	it.each(catalogue)(
		'$scenario.id has the metadata needed to browse and run it',
		({ scenario }) => {
			expect(scenario.id).toMatch(/^[a-z][a-z0-9-]*$/);
			expect(scenario.label.trim()).not.toBe('');
			expect(scenario.group.trim()).not.toBe('');
			expect(Number.isFinite(scenario.order)).toBe(true);
		},
	);
});
