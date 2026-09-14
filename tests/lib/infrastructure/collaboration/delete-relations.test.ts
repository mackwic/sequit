import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { readSharedCommand } from '../../../../src/lib/infrastructure/collaboration/shared-command-codec';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import {
	importLogicDocument,
	readLogicDocument,
} from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { SharedCommandKind } from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

it('checks all relation targets before deleting and collects orphan junctions after the complete gesture', () => {
	const source: LogicDocument = {
		...collaborativeFixture(CollaborativeFixture.TwoBoxes, 'room'),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'J',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a2'),
			},
		],
		relations: [
			{ id: 'BJ', from: 'B', to: 'J' },
			{ id: 'JA', from: 'J', to: 'A' },
		],
	};
	const doc = new Y.Doc();
	importLogicDocument(doc, source);
	expect(() =>
		executeSharedCommands(doc, [{ op: SharedCommandKind.DeleteRelations, ids: ['BJ', 'missing'] }]),
	).toThrow();
	expect(readLogicDocument(doc)).toEqual({ ok: true, value: source });
	const result = executeSharedCommands(doc, [
		readSharedCommand({ op: SharedCommandKind.DeleteRelations, ids: ['BJ', 'JA', 'BJ'] }),
	]);
	expect(result.relations).toEqual([]);
	expect(result.junctions).toEqual([]);
	expect(result.nodes).toEqual(source.nodes);
	doc.destroy();
});

it.each([[], [''], [42], ['a'.repeat(129)], 'relation'])(
	'rejects malformed bulk relation targets: %j',
	(ids) => {
		expect(() => readSharedCommand({ op: SharedCommandKind.DeleteRelations, ids })).toThrow();
	},
);
