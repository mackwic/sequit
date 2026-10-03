import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	parseNodeClipboard,
	planNodePaste,
	selectionPasteDestination,
	serializeSelectedNodes,
} from '../../../../../src/app/web/document/node-clipboard';
import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import { GroupState } from '../../../../../src/lib/core/document/logic-document';
import { executeSharedCommands } from '../../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../support/fixtures/collaborative-document';

it('duplicates only selected nodes, as one valid batch with fresh identities', () => {
	const base = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'clipboard');
	const source = {
		...base,
		nodes: base.nodes.map((node) => {
			if (node.id !== 'A') return node;
			return { ...node, markdown: '**Alpha**', description: 'Details\n\n- item', color: '#abc' };
		}),
	};
	const selection = [
		{ kind: EntityKind.Node, id: 'A' },
		{ kind: EntityKind.Node, id: 'B' },
	];
	const text = serializeSelectedNodes(source, selection);
	expect(text).toBeDefined();
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	expect(clipboard?.nodes).toHaveLength(2);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	expect(plan?.commands).toHaveLength(2);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.nodes.map(({ id }) => id)).toEqual(['A', 'B', 'copy-1', 'copy-2']);
		expect(result.nodes[2]).toMatchObject({
			natureId: source.nodes[0]?.natureId,
			markdown: '**Alpha**',
			description: 'Details\n\n- item',
			color: '#abc',
		});
		expect(result.relations).toEqual(source.relations);
		expect(result.junctions).toEqual(source.junctions);
	} finally {
		ydoc.destroy();
	}
});

it('rejects mixed selections and fragments from another document', () => {
	const source = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'clipboard');
	expect(
		serializeSelectedNodes(source, [
			{ kind: EntityKind.Node, id: 'A' },
			{ kind: EntityKind.Relation, id: 'R' },
		]),
	).toBeUndefined();
	const text = serializeSelectedNodes(source, [{ kind: EntityKind.Node, id: 'A' }]);
	expect(parseNodeClipboard(text ?? '', 'other-document')).toBeUndefined();
});

it('pastes into the selected group and expands it in the same batch', () => {
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'clipboard');
	const closed = {
		...source,
		groups: source.groups.map((group) => ({ ...group, state: GroupState.Closed })),
	};
	const text = serializeSelectedNodes(source, [{ kind: EntityKind.Node, id: 'A' }]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	const destination = selectionPasteDestination(closed, [{ kind: EntityKind.Group, id: 'G' }]);
	const plan = clipboard && planNodePaste(closed, clipboard, destination, () => 'copy');
	expect(plan?.commands).toHaveLength(2);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, closed);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.groups.find(({ id }) => id === 'G')?.state).toBe(GroupState.Expanded);
		expect(result.nodes.find(({ id }) => id === 'copy')?.groupId).toBe('G');
	} finally {
		ydoc.destroy();
	}
});
