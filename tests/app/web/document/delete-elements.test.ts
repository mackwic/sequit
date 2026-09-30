import fc from 'fast-check';
import { expect, it, vi } from 'vitest';

import { deletion } from '../../../../src/app/web/document/document-commands';
import { createLocalDocumentSession } from '../../../../src/app/web/document/local-document-session';
import { openDocument } from '../../../../src/app/web/projection/open-document';
import {
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import type { DocumentSession } from '../../../../src/lib/infrastructure/collaboration/collaborative-document-session-types';
import { DocumentCommandOutcomeKind } from '../../../../src/lib/infrastructure/document/document-command-contracts';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';
import { aiDocumentaryEffortScenario } from '../../../support/scenarios/ai-documentary-effort';

async function deleteElements(
	session: DocumentSession,
	endpointIds: readonly string[],
	relationIds: readonly string[],
): Promise<LogicDocument> {
	const outcome = await session.dispatch(deletion(session.read(), endpointIds, relationIds));
	if (outcome.kind !== DocumentCommandOutcomeKind.Accepted)
		throw new Error(`Expected an accepted deletion, got ${outcome.kind}`);
	return outcome.document;
}

it('deletes a group subtree and incident relations in one accepted publication', async () => {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'deletion');
	const session = createLocalDocumentSession({
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
	const result = await deleteElements(session, ['G'], ['R']);
	expect(result.nodes).toEqual([]);
	expect(result.groups).toEqual([]);
	expect(result.junctions).toEqual([]);
	expect(result.relations).toEqual([]);
	expect(subscriber).toHaveBeenCalledExactlyOnceWith(result);
	session.destroy();
	expect(() => session.dispatch([])).toThrow('destroyed');
});

it('preserves unselected nodes and never leaves a relation to a deleted endpoint', async () => {
	await fc.assert(
		fc.asyncProperty(fc.subarray(['A', 'B']), fc.boolean(), async (ids, removeRelation) => {
			const model = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'deletion');
			const session = createLocalDocumentSession(model);
			const relationIds: string[] = [];
			if (removeRelation) relationIds.push('R');
			try {
				const result = await deleteElements(session, ids, relationIds);
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
	const result = await deleteElements(opened.value.session, [id], []);
	expect(result.nodes).toHaveLength(before.nodes.length - 1);
	expect(opened.value.read()).toEqual(result);
	opened.value.destroy();
});
