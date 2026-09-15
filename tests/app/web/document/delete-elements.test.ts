import fc from 'fast-check';
import { expect, it, vi } from 'vitest';

import { createDocumentSession } from '../../../../src/app/web/document/yjs-document-session';
import { openDocument } from '../../../../src/app/web/projection/open-document';
import { EndpointKind, JunctionOperator } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

it('deletes a group subtree and incident relations in one accepted publication', async () => {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'deletion');
	const session = createDocumentSession({
		...model,
		groups: [
			...model.groups,
			{
				kind: EndpointKind.Group,
				id: 'H',
				groupId: 'G',
				label: 'Nested',
				layoutOrder: orderKey('a3'),
			},
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'J',
				groupId: 'H',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a4'),
			},
		],
	});
	const subscriber = vi.fn();
	session.subscribe(subscriber);
	const result = await session.deleteElements(['G'], ['R']);
	expect(result.nodes).toEqual([]);
	expect(result.groups).toEqual([]);
	expect(result.junctions).toEqual([]);
	expect(result.relations).toEqual([]);
	expect(subscriber).toHaveBeenCalledExactlyOnceWith(result);
	session.destroy();
	await expect(session.deleteElements(['G'], [])).rejects.toThrow('destroyed');
});

it('preserves unselected nodes and never leaves a relation to a deleted endpoint', async () => {
	await fc.assert(
		fc.asyncProperty(fc.subarray(['A', 'B']), fc.boolean(), async (ids, removeRelation) => {
			const model = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'deletion');
			const session = createDocumentSession(model);
			const relationIds: string[] = [];
			if (removeRelation) relationIds.push('R');
			try {
				const result = await session.deleteElements(ids, relationIds);
				expect(result.nodes).toEqual(model.nodes.filter(({ id }) => !ids.includes(id)));
				const expected = model.relations.filter(
					({ from, to, id }) =>
						!ids.includes(from) && !ids.includes(to) && !relationIds.includes(id),
				);
				expect(result.relations).toEqual(expected);
			} finally {
				session.destroy();
			}
		}),
		{ numRuns: 20 },
	);
});

it('publishes deletions through the opened document used by the canvas', async () => {
	const opened = openDocument(await aiDocumentaryEffortScenario());
	if (!opened.ok) throw new Error('Invalid fixture');
	const before = opened.value.read();
	const id = before.nodes[0]?.id;
	if (id === undefined) throw new Error('Missing node');
	const result = await opened.value.deleteElements([id], []);
	expect(result.nodes).toHaveLength(before.nodes.length - 1);
	expect(opened.value.read()).toEqual(result);
	opened.value.destroy();
});
