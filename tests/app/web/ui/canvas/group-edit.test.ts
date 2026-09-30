import { describe, expect, it } from 'vitest';

import { EntityKind, entityRef } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import { foldActionLabel, groupableNodeIds } from '../../../../../src/app/web/ui/canvas/group-edit';
import type { LogicDocument } from '../../../../../src/lib/core/document/logic-document';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../support/fixtures/collaborative-document';

/** A and B inside G; C outside, at the root. */
function document(): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'group-edit');
	const first = model.nodes[0];
	if (first === undefined) throw new Error('Expected the fixture nodes');
	const root = { ...first, id: 'C' };
	delete root.groupId;
	return { ...model, nodes: [...model.nodes, root] };
}

describe('groupableNodeIds', () => {
	it('accepts two or more nodes from the same container, in selection order', () => {
		expect(
			groupableNodeIds(document(), [
				entityRef(EntityKind.Node, 'B'),
				entityRef(EntityKind.Node, 'A'),
			]),
		).toEqual(['B', 'A']);
	});

	it('refuses a single node, a mixed selection, and nodes from different containers', () => {
		const model = document();
		expect(groupableNodeIds(model, [entityRef(EntityKind.Node, 'A')])).toBeUndefined();
		expect(
			groupableNodeIds(model, [entityRef(EntityKind.Node, 'A'), entityRef(EntityKind.Group, 'G')]),
		).toBeUndefined();
		expect(
			groupableNodeIds(model, [entityRef(EntityKind.Node, 'A'), entityRef(EntityKind.Node, 'C')]),
		).toBeUndefined();
	});

	it('refuses a selection that names a node the document no longer has', () => {
		expect(
			groupableNodeIds(document(), [
				entityRef(EntityKind.Node, 'A'),
				entityRef(EntityKind.Node, 'gone'),
			]),
		).toBeUndefined();
	});
});

it('names the fold action by its effect', () => {
	expect(foldActionLabel(true)).toBe('Déplier');
	expect(foldActionLabel(false)).toBe('Replier');
});
