import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compareCanonicalStrings } from '../../../../src/lib/core/canonical-string';
import {
	anonymizeDocument,
	ANONYMOUS_TEXT,
	isAnonymizedDocument,
} from '../../../../src/lib/core/document/anonymize-document';
import type { LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { parseSequitToml } from '../../../../src/lib/infrastructure/toml/parse-sequit-toml';
import { serializeSequitToml } from '../../../../src/lib/infrastructure/toml/serialize-sequit-toml';
import { regionGridDocument } from '../../../support/builders/region-grid-document';
import { regionLaneDocumentWithRootLanes } from '../../../support/builders/region-lane-document';

function exampleDocument(): LogicDocument {
	const source = readFileSync(
		new URL('../../../../examples/ai-documentation.sequit.toml', import.meta.url),
		'utf8',
	);
	const parsed = parseSequitToml(source);
	if (!parsed.ok) throw new Error('The example document must parse');
	return parsed.value;
}

describe('document anonymization', () => {
	it('leaves no original text and no original identifier in the persisted document', () => {
		const original = exampleDocument();
		const { document } = anonymizeDocument(original);
		const source = serializeSequitToml(document);
		for (const text of [
			original.title,
			...original.natures.map(({ label }) => label),
			...original.groups.map(({ label }) => label),
			...original.nodes.map(({ markdown }) => markdown),
		])
			expect(source).not.toContain(text);
		for (const id of [original.id, ...original.nodes.map(({ id }) => id)])
			expect(source).not.toMatch(new RegExp(`\\b${id}\\b`));
		expect(document.title).toBe(ANONYMOUS_TEXT);
		expect(new Set(document.nodes.map(({ markdown }) => markdown))).toEqual(
			new Set([ANONYMOUS_TEXT]),
		);
	});

	it('keeps the canonical order of identifiers, so tie-breaks by identifier decide alike', () => {
		const { identifiers } = anonymizeDocument(exampleDocument());
		const originals = [...identifiers.keys()].sort(compareCanonicalStrings);
		const tokens = originals.map((id) => identifiers.get(id) ?? '');
		expect([...tokens].sort(compareCanonicalStrings)).toEqual(tokens);
		expect(new Set(tokens.map((token) => token.length)).size).toBe(1);
	});

	it('renames every reference with the identifier it points to', () => {
		const original = exampleDocument();
		const { document, identifiers } = anonymizeDocument(original);
		expect(document.relations).toEqual(
			original.relations.map(({ id, from, to }) => ({
				id: identifiers.get(id),
				from: identifiers.get(from),
				to: identifiers.get(to),
			})),
		);
		expect(document.nodes.map(({ natureId, groupId }) => [natureId, groupId])).toEqual(
			original.nodes.map(({ natureId, groupId }) => [
				identifiers.get(natureId),
				identifiers.get(groupId ?? ''),
			]),
		);
		expect(validateLogicDocument(document).ok).toBe(true);
	});

	it('anonymizes regions, grid cells and the lanes scoped to a region', () => {
		const original = regionGridDocument();
		const { document, identifiers } = anonymizeDocument(original);
		const regions = document.regionPresentation?.regions ?? [];
		expect(regions.map(({ id }) => id)).toEqual(
			original.regionPresentation?.regions.map(({ id }) => identifiers.get(id)),
		);
		const grid = regions.find(({ grid: cells }) => cells !== undefined)?.grid;
		expect(grid?.cells.map(({ regionId }) => regionId)).toEqual(
			['a', 'b', 'c', 'd'].map((id) => identifiers.get(id)),
		);
		const lanes = regions.flatMap(({ lanePresentation }) => lanePresentation?.lanes ?? []);
		expect(lanes.map(({ id, label }) => [id, label])).toEqual([
			[identifiers.get('left'), ANONYMOUS_TEXT],
			[identifiers.get('right'), ANONYMOUS_TEXT],
		]);
		expect(regions.find(({ id }) => id === identifiers.get('a'))?.parentId).toBe(
			identifiers.get('branch'),
		);
		expect(validateLogicDocument(document).ok).toBe(true);
		expect(isAnonymizedDocument(document)).toBe(true);
	});

	it('anonymizes root lanes and box descriptions', () => {
		const source = regionLaneDocumentWithRootLanes();
		const [first, ...others] = source.nodes;
		if (first === undefined) throw new Error('The fixture has nodes');
		const original = { ...source, nodes: [{ ...first, description: 'Pourquoi' }, ...others] };
		const { document, identifiers } = anonymizeDocument(original);
		expect(document.presentation?.lanes.map(({ id, label }) => [id, label])).toEqual(
			source.presentation?.lanes.map(({ id }) => [identifiers.get(id), ANONYMOUS_TEXT]),
		);
		expect(document.nodes[0]?.description).toBe(ANONYMOUS_TEXT);
		expect(isAnonymizedDocument(document)).toBe(true);
	});

	it('recognizes only documents made of `xxx` texts and anonymous identifiers', () => {
		const original = exampleDocument();
		const { document } = anonymizeDocument(original);
		expect(isAnonymizedDocument(document)).toBe(true);
		expect(isAnonymizedDocument(original)).toBe(false);
		expect(isAnonymizedDocument({ ...document, title: 'Secret plan' })).toBe(false);
		expect(isAnonymizedDocument({ ...document, id: 'secret-plan' })).toBe(false);
		const [first, ...others] = document.nodes;
		if (first === undefined) throw new Error('The example has nodes');
		expect(
			isAnonymizedDocument({
				...document,
				nodes: [{ ...first, description: 'Why it matters' }, ...others],
			}),
		).toBe(false);
	});
});
