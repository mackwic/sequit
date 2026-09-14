import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	deleteVisibleRelation,
	hiddenRelationFields,
} from '../../../../src/app/web/projection/visible-relation-commands';
import { projectCollapsedDocument } from '../../../../src/lib/core/document/collapsed-document';
import {
	defined,
	EndpointKind,
	GroupState,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import {
	decodeSessionMessage,
	encodeSessionMessage,
	SessionMessageKind,
} from '../../../../src/lib/infrastructure/collaboration/session-wire';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { sharedElementOrder } from '../../../../src/lib/infrastructure/document/shared-command-rules';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('deletes every original relation in one batch and prevents retargeting a hidden destination', () => {
	const relation = {
		sourceRelationIds: ['first', 'second'],
		canChangeFrom: true,
		canChangeTo: false,
	};
	expect(deleteVisibleRelation(relation)).toEqual([
		{ op: SharedCommandKind.DeleteRelations, ids: ['first', 'second'] },
	]);
	expect(hiddenRelationFields(relation)).toEqual(['to']);
	expect(
		hiddenRelationFields({
			...relation,
			canChangeFrom: false,
			canChangeTo: true,
		}),
	).toEqual(['from']);
});

it('deletes a 150-source visible aggregate through one wire command without removing its nodes', () => {
	const fixture = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'bulk-relations');
	const root = defined(fixture.nodes[0]);
	const member = defined(fixture.nodes[1]);
	const members = Array.from({ length: 150 }, (_, index) => {
		const id = `member-${index}`;
		return { ...member, id, groupId: 'G', layoutOrder: sharedElementOrder(id) };
	});
	const document: LogicDocument = {
		...fixture,
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'G',
				label: 'Many branches',
				state: GroupState.Expanded,
				layoutOrder: sharedElementOrder('G'),
			},
		],
		nodes: [root, ...members],
		relations: members.map(({ id }) => ({
			id: `relation-${id}`,
			from: id,
			to: root.id,
		})),
	};
	const projection = projectCollapsedDocument(document, ['G']);
	expect(projection.relations.size).toBe(1);
	const visible = defined(projection.relations.values().next().value);
	expect(visible.sourceRelationIds).toHaveLength(150);
	const commands = deleteVisibleRelation(visible);
	expect(commands).toHaveLength(1);
	const wire = decodeSessionMessage(
		encodeSessionMessage({
			type: SessionMessageKind.Change,
			id: 'delete-aggregate',
			sessionId: 'session-bulk',
			sequence: 1,
			commands,
		}),
	);
	if (wire.type !== SessionMessageKind.Change || !('commands' in wire))
		throw new Error('Expected structural command');
	const shared = new Y.Doc();
	try {
		importLogicDocument(shared, document);
		const result = executeSharedCommands(shared, wire.commands);
		expect(result.relations).toEqual([]);
		expect(result.nodes).toHaveLength(151);
		expect(result.groups).toEqual(document.groups);
	} finally {
		shared.destroy();
	}
});
