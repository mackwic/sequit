import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import { parseSequitToml } from '../../src/lib/text/parse-sequit-toml';
import { serializeSequitToml } from '../../src/lib/text/serialize-sequit-toml';
import { validLogicDocument } from '../builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../builders/logic-document-arbitrary';
import { PROPERTY_PARAMETERS } from '../builders/property-test-options';

function canonicalEntities<T extends { readonly id: string }>(
	entities: readonly T[],
): readonly T[] {
	return [...entities].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalDocument(document: LogicDocument): LogicDocument {
	return {
		...document,
		natures: canonicalEntities(document.natures),
		groups: canonicalEntities(document.groups),
		nodes: canonicalEntities(document.nodes),
		junctions: canonicalEntities(document.junctions),
		relations: canonicalEntities(document.relations),
	};
}

function reversedCollections(document: LogicDocument): LogicDocument {
	return {
		...document,
		natures: [...document.natures].reverse(),
		groups: [...document.groups].reverse(),
		nodes: [...document.nodes].reverse(),
		junctions: [...document.junctions].reverse(),
		relations: [...document.relations].reverse(),
	};
}

describe('generated persistent documents', () => {
	it('serializes optional group membership for junctions', () => {
		const source = serializeSequitToml(validLogicDocument());
		expect(source).toContain('group = "container"');
		expect(parseSequitToml(source)).toMatchObject({ ok: true });
	});

	it('preserves every generated document through TOML serialization and parsing', () => {
		fc.assert(
			fc.property(richAcyclicLogicDocumentArbitrary(), (document) => {
				const source = serializeSequitToml(document);
				const parsed = parseSequitToml(source);
				expect(parsed).toEqual({ ok: true, value: canonicalDocument(document) });
				if (!parsed.ok) throw new Error('Expected generated TOML to parse');
				expect(serializeSequitToml(parsed.value)).toBe(source);
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('is independent of every document collection order', () => {
		fc.assert(
			fc.property(richAcyclicLogicDocumentArbitrary(), (document) => {
				expect(serializeSequitToml(reversedCollections(document))).toBe(
					serializeSequitToml(document),
				);
			}),
			PROPERTY_PARAMETERS,
		);
	});
});
