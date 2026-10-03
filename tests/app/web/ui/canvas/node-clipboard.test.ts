import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	parseNodeClipboard,
	planNodePaste,
	selectionPasteDestination,
	serializeSelectedNodes,
} from '../../../../../src/app/web/document/node-clipboard';
import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	EndpointKind,
	GroupState,
	JunctionOperator,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { executeSharedCommands } from '../../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../support/fixtures/collaborative-document';

it('duplicates selected nodes and their internal relation as one valid batch', () => {
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
	expect(plan?.commands).toHaveLength(3);
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
		expect(result.relations).toEqual([
			...source.relations,
			{ id: 'copy-3', from: 'copy-2', to: 'copy-1' },
		]);
		expect(result.junctions).toEqual(source.junctions);
	} finally {
		ydoc.destroy();
	}
});

it('copies only the relation between selected nodes, leaving external edges behind', () => {
	const base = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'clipboard');
	const template = base.nodes[0];
	if (template === undefined) throw new Error('Expected a fixture node');
	const source = {
		...base,
		nodes: [
			...base.nodes,
			{
				...template,
				id: 'C',
				markdown: 'Charlie',
				layoutOrder: orderKey('a2'),
			},
		],
		relations: [...base.relations, { id: 'RC', from: 'C', to: 'B' }],
	};
	const text = serializeSelectedNodes(source, [
		{ kind: EntityKind.Node, id: 'B' },
		{ kind: EntityKind.Node, id: 'C' },
	]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(
			result.nodes.filter(({ id }) => id.startsWith('copy-')).map(({ markdown }) => markdown),
		).toEqual(['Bravo', 'Charlie']);
		expect(result.relations.filter(({ id }) => id.startsWith('copy-'))).toEqual([
			{ id: 'copy-3', from: 'copy-2', to: 'copy-1' },
		]);
	} finally {
		ydoc.destroy();
	}
});

it('copies a junction path between selected nodes without its external branch', () => {
	const base = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'clipboard');
	const template = base.nodes[0];
	if (template === undefined) throw new Error('Expected a fixture node');
	const source: LogicDocument = {
		...base,
		nodes: [
			...base.nodes,
			{ ...template, id: 'C', markdown: 'Charlie', layoutOrder: orderKey('a2') },
		],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'J',
				operator: JunctionOperator.Or,
				layoutOrder: orderKey('a3'),
			},
		],
		relations: [
			{ id: 'RJ1', from: 'B', to: 'J' },
			{ id: 'RJ2', from: 'J', to: 'A' },
			{ id: 'RJ3', from: 'C', to: 'J' },
		],
	};
	const text = serializeSelectedNodes(source, [
		{ kind: EntityKind.Node, id: 'A' },
		{ kind: EntityKind.Node, id: 'B' },
	]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.junctions.filter(({ id }) => id.startsWith('copy-'))).toMatchObject([
			{ id: 'copy-3', operator: JunctionOperator.Or },
		]);
		expect(result.relations.filter(({ id }) => id.startsWith('copy-'))).toEqual([
			{ id: 'copy-4', from: 'copy-2', to: 'copy-3' },
			{ id: 'copy-5', from: 'copy-3', to: 'copy-1' },
		]);
	} finally {
		ydoc.destroy();
	}
});

it('copies a group containing the selected nodes and remaps its internal relation', () => {
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'clipboard');
	const text = serializeSelectedNodes(source, [
		{ kind: EntityKind.Node, id: 'A' },
		{ kind: EntityKind.Node, id: 'B' },
	]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.groups.filter(({ id }) => id.startsWith('copy-'))).toMatchObject([
			{ id: 'copy-1', label: 'Groupe' },
		]);
		expect(result.nodes.filter(({ id }) => id.startsWith('copy-'))).toMatchObject([
			{ id: 'copy-2', groupId: 'copy-1' },
			{ id: 'copy-3', groupId: 'copy-1' },
		]);
		expect(result.relations.filter(({ id }) => id.startsWith('copy-'))).toEqual([
			{ id: 'copy-4', from: 'copy-3', to: 'copy-2' },
		]);
	} finally {
		ydoc.destroy();
	}
});

it('copies a partial group into a new group containing only the selected node', () => {
	const source = collaborativeFixture(CollaborativeFixture.OpenGroup, 'clipboard');
	const text = serializeSelectedNodes(source, [{ kind: EntityKind.Node, id: 'A' }]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.groups.filter(({ id }) => id.startsWith('copy-'))).toMatchObject([
			{ id: 'copy-1', label: 'Groupe' },
		]);
		expect(result.nodes.find(({ id }) => id === 'copy-2')?.groupId).toBe('copy-1');
		expect(result.relations).toEqual(source.relations);
	} finally {
		ydoc.destroy();
	}
});

it('preserves nested groups around copied nodes', () => {
	const base = collaborativeFixture(CollaborativeFixture.OpenGroup, 'clipboard');
	const source: LogicDocument = {
		...base,
		groups: [
			...base.groups,
			{
				kind: EndpointKind.Group,
				id: 'H',
				label: 'Sous-groupe',
				groupId: 'G',
				layoutOrder: orderKey('a3'),
			},
		],
		nodes: base.nodes.map((node) => {
			if (node.id === 'A') return { ...node, groupId: 'H' };
			return node;
		}),
	};
	const text = serializeSelectedNodes(source, [
		{ kind: EntityKind.Node, id: 'A' },
		{ kind: EntityKind.Node, id: 'B' },
	]);
	const clipboard = parseNodeClipboard(text ?? '', source.id);
	let next = 0;
	const plan = clipboard && planNodePaste(source, clipboard, undefined, () => `copy-${++next}`);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, source);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.groups.find(({ id }) => id === 'copy-1')?.label).toBe('Groupe');
		expect(result.groups.find(({ id }) => id === 'copy-2')?.groupId).toBe('copy-1');
		expect(result.nodes.find(({ id }) => id === 'copy-3')?.groupId).toBe('copy-2');
		expect(result.nodes.find(({ id }) => id === 'copy-4')?.groupId).toBe('copy-1');
		expect(result.relations).toContainEqual({
			id: 'copy-5',
			from: 'copy-4',
			to: 'copy-3',
		});
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
	let next = 0;
	const plan = clipboard && planNodePaste(closed, clipboard, destination, () => `copy-${++next}`);
	expect(plan?.commands).toHaveLength(3);
	const ydoc = new Y.Doc();
	try {
		importLogicDocument(ydoc, closed);
		const result = executeSharedCommands(ydoc, plan?.commands ?? []);
		expect(result.groups.find(({ id }) => id === 'G')?.state).toBe(GroupState.Expanded);
		expect(result.groups.find(({ id }) => id === 'copy-1')?.groupId).toBe('G');
		expect(result.nodes.find(({ id }) => id === 'copy-2')?.groupId).toBe('copy-1');
	} finally {
		ydoc.destroy();
	}
});
