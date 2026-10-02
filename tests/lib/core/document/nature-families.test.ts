import { expect, it } from 'vitest';

import {
	type LogicNature,
	natureFamilyField,
} from '../../../../src/lib/core/document/logic-document';
import {
	defaultNatures,
	firstNature,
	NATURE_FAMILIES,
	natureFamilyGroups,
	NatureFamilyId,
} from '../../../../src/lib/core/document/nature-families';
import { validateLogicDocument } from '../../../../src/lib/core/document/validate-logic-document';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('starts a document with the Generic family, led by Node, which has no icon', () => {
	expect(defaultNatures().map(({ id, family }) => [id, family])).toEqual([
		['node', 'generic'],
		['comment', 'generic'],
		['problem', 'generic'],
		['idea', 'generic'],
		['question', 'generic'],
	]);
	expect(defaultNatures()[0]).not.toHaveProperty('icon');
	const sortedById = [...defaultNatures()].sort((left, right) => left.id.localeCompare(right.id));
	expect(firstNature(sortedById)?.id).toBe('node');
	expect(firstNature([])).toBeUndefined();
});

it('defines valid families whose natures carry their family and unique identifiers', () => {
	const natures = NATURE_FAMILIES.flatMap((family) => family.natures);
	expect(new Set(natures.map(({ id }) => id)).size).toBe(natures.length);
	for (const family of NATURE_FAMILIES)
		expect(family.natures.every((nature) => nature.family === family.id)).toBe(true);
	expect(validateLogicDocument({ ...validLogicDocument(), natures }).ok).toBe(true);
});

it('groups natures by family in catalogue order, then those of no or unknown family by label', () => {
	const nature = (id: string, label: string, family?: string): LogicNature => ({
		id,
		label,
		color: '#000000',
		...natureFamilyField(family),
	});
	const groups = natureFamilyGroups([
		nature('zeta', 'zeta', 'later-family'),
		nature('keep', 'Keep', NatureFamilyId.RetroKds),
		nature('custom', 'Custom', NatureFamilyId.Generic),
		nature('question', 'Question', NatureFamilyId.Generic),
		nature('node', 'Node', NatureFamilyId.Generic),
		nature('alpha', 'Alpha'),
	]);
	expect(groups.map((group) => [group.family?.id, group.natures.map(({ id }) => id)])).toEqual([
		[NatureFamilyId.Generic, ['node', 'question', 'custom']],
		[NatureFamilyId.RetroKds, ['keep']],
		[undefined, ['alpha', 'zeta']],
	]);
});
