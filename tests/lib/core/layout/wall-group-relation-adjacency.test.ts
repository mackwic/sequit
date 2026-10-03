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
	// The target centers on its related items, the frame and c, in any rank order. Member-expanded
	// edges center it on a, b, d and c instead, 6 units aside.
	const c = defined(bounds.get('c'));
	const start = Math.min(frame.x, c.x);
	const end = Math.max(frame.x + frame.width, c.x + c.width);
	expect(target.x + target.width / 2).toBe((start + end) / 2);

	const adjacency = rawAdjacency(prepared.graph);
	const parents = defined(adjacency.children.get('e'));
	expect(parents).toContain('group');
	expect(parents).toContain('c');
	for (const member of ['a', 'b', 'd']) expect(parents).not.toContain(member);
});
