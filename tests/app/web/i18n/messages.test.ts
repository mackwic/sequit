import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../../../messages');
const baseLocale = 'fr';
const locales = readdirSync(root);
const areas = readdirSync(join(root, baseLocale));

function catalogue(locale: string, area: string): Map<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(join(root, locale, area), 'utf8'));
	if (typeof parsed !== 'object' || parsed === null) throw new Error(`${locale}/${area}`);
	const messages = new Map(Object.entries(parsed));
	messages.delete('$schema');
	return messages;
}

/** The inputs a message reads; a translation that drops or renames one shows wrong text. */
function inputs(message: unknown): Set<string> {
	if (typeof message === 'string')
		return new Set(
			[...message.matchAll(/(?<!\\)\{([A-Za-z_]\w*)\}/g)].map(([, name]) => name ?? ''),
		);
	let variants: unknown;
	if (Array.isArray(message)) variants = message.at(0);
	if (
		typeof variants !== 'object' ||
		variants === null ||
		!('declarations' in variants) ||
		!Array.isArray(variants.declarations)
	)
		throw new Error(`Unexpected message: ${JSON.stringify(message)}`);
	return new Set(
		variants.declarations
			.filter((declaration): declaration is string => typeof declaration === 'string')
			.filter((declaration) => declaration.startsWith('input '))
			.map((declaration) => declaration.slice('input '.length)),
	);
}

describe('message catalogues', () => {
	it('gives each message a single area', () => {
		const owners = new Map<string, string>();
		for (const area of areas) {
			for (const key of catalogue(baseLocale, area).keys()) {
				expect(owners.get(key), key).toBeUndefined();
				owners.set(key, area);
			}
		}
	});

	it.each(locales.filter((locale) => locale !== baseLocale))(
		'translates every %s message with the same inputs',
		(locale) => {
			expect(readdirSync(join(root, locale)).sort()).toEqual([...areas].sort());
			for (const area of areas) {
				const base = catalogue(baseLocale, area);
				const translated = catalogue(locale, area);
				expect([...translated.keys()].sort(), `${locale}/${area}`).toEqual([...base.keys()].sort());
				for (const [key, message] of base) {
					expect(inputs(translated.get(key)), `${locale}/${area}: ${key}`).toEqual(inputs(message));
				}
			}
		},
	);
});
