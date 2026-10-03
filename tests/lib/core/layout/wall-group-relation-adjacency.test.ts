import { expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { rawAdjacency } from '../../../../src/lib/core/layout/structure/relation-adjacency';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { multirankOne } from '../../../support/scenarios/dedicated-channel-witnesses';

it('keeps a relation to a populated group at its frame in row adjacency', () => {
	const prepared = prepareLayoutDocument({
		...multirankOne,
		relations: [...multirankOne.relations, { id: 'group-to-e', from: 'group', to: 'e' }],
	});
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const bounds = new Map(layout.elements.map(({ id, bounds }) => [id, bounds]));
	const frame = defined(bounds.get('group'));
	const target = defined(bounds.get('e'));
	// Member-expanded edges shift this target from the frame's 24-unit offset to 18.
	expect(target.x - frame.x).toBe(24);

	const adjacency = rawAdjacency(prepared.graph);
	const parents = defined(adjacency.children.get('e'));
	expect(parents).toContain('group');
	expect(parents).toContain('c');
	for (const member of ['a', 'b', 'd']) expect(parents).not.toContain(member);
});
