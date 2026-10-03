import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import { restoreHistoryStep } from '../../../../src/lib/infrastructure/document/history-restoration';
import {
	SharedCommandKind as Op,
	type SharedDocumentCommand,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

function execute(model: LogicDocument, commands: readonly SharedDocumentCommand[]): LogicDocument {
	const document = new Y.Doc();
	try {
		importLogicDocument(document, model);
		return executeSharedCommands(document, commands);
	} finally {
		document.destroy();
	}
}

/** What a person sees of a graph, independent of collection order. */
function shape(document: LogicDocument) {
	return {
		layout: document.layout,
		natures: document.natures.map(({ id, color }) => `${id} ${color}`).sort(),
		groups: document.groups.map(({ id, label, groupId }) => `${id} ${label} ${groupId}`).sort(),
		nodes: document.nodes
			.map(({ id, natureId, markdown, groupId, color }) =>
				[id, natureId, markdown, groupId, color].join(' '),
			)
			.sort(),
		junctions: document.junctions.map(({ id, operator }) => `${id} ${operator}`).sort(),
		relations: document.relations.map(({ id, from, to }) => `${id} ${from}→${to}`).sort(),
	};
}

/** Runs a step, undoes it on the document it produced, then redoes it on the undone one. */
function roundTrip(before: LogicDocument, commands: readonly SharedDocumentCommand[]) {
	const after = execute(before, commands);
	const undone = execute(after, restoreHistoryStep({ from: after, to: before }, after));
	const redone = execute(undone, restoreHistoryStep({ from: before, to: after }, undone));
	return { after, undone, redone };
}

it('undoes and redoes a junction insertion as one batch, back to the same graph', () => {
	const before = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'history');
	const { after, undone, redone } = roundTrip(before, [
		{
			op: Op.Create,
			target: { kind: Kind.Junction, id: 'J' },
			properties: { operator: JunctionOperator.Xor },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'BJ' },
			properties: { from: 'B', to: 'J' },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'JA' },
			properties: { from: 'J', to: 'A' },
		},
		{ op: Op.DeleteRelations, ids: ['R'] },
	]);
	expect(shape(undone)).toEqual(shape(before));
	expect(shape(redone)).toEqual(shape(after));
});

it('brings a deleted box back with its text and relations, then deletes it again', () => {
	const before = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'history');
	const { undone, redone } = roundTrip(before, [
		{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } },
	]);
	expect(shape(undone)).toEqual(shape(before));
	expect(undone.nodes.find(({ id }) => id === 'B')?.markdown).toBe('Bravo');
	expect(redone.nodes.map(({ id }) => id)).toEqual(['A']);
	expect(redone.relations).toEqual([]);
});

it('dissolves a group the step created, then groups the same members again', () => {
	const before = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'history');
	const { after, undone, redone } = roundTrip(before, [
		{ op: Op.Group, id: 'G', label: 'Pistes', members: ['A', 'B'] },
	]);
	expect(shape(undone)).toEqual(shape(before));
	expect(shape(redone)).toEqual(shape(after));
	expect(redone.nodes.every(({ groupId }) => groupId === 'G')).toBe(true);
});

it('sets back only what the step changed, keeping what others changed since', () => {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'history');
	const before = {
		...model,
		natures: [...model.natures, { id: 'M', label: 'But', color: '#123' }],
	};
	const after = execute(before, [
		{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { natureId: 'M' }, unset: [] },
		{
			op: Op.UpdateLayout,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
		},
	]);
	const current = execute(after, [
		{ op: Op.Update, target: { kind: Kind.Node, id: 'A' }, set: { color: '#abcdef' }, unset: [] },
	]);
	const undone = execute(current, restoreHistoryStep({ from: after, to: before }, current));
	expect(undone.nodes.find(({ id }) => id === 'A')).toMatchObject({
		natureId: 'N',
		color: '#abcdef',
	});
	expect(undone.layout).toEqual(before.layout);
});

it('leaves an element others deleted since, so nothing is left to restore', () => {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'history');
	const before = {
		...model,
		natures: [...model.natures, { id: 'M', label: 'But', color: '#123' }],
	};
	const after = execute(before, [
		{ op: Op.Update, target: { kind: Kind.Node, id: 'B' }, set: { natureId: 'M' }, unset: [] },
	]);
	const current = execute(after, [{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } }]);
	expect(restoreHistoryStep({ from: after, to: before }, current)).toEqual([]);
	expect(restoreHistoryStep({ from: after, to: before }, before)).toEqual([]);
});

it('removes a junction the step created even when others anchored it since', () => {
	const before = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'history');
	const after = execute(before, [
		{
			op: Op.Create,
			target: { kind: Kind.Junction, id: 'J' },
			properties: { operator: JunctionOperator.And },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'BJ' },
			properties: { from: 'B', to: 'J' },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'JA' },
			properties: { from: 'J', to: 'A' },
		},
	]);
	const current = execute(after, [
		{
			op: Op.Create,
			target: { kind: Kind.Node, id: 'C' },
			properties: { natureId: 'N', markdown: 'C' },
		},
		{
			op: Op.Create,
			target: { kind: Kind.Relation, id: 'CJ' },
			properties: { from: 'C', to: 'J' },
		},
	]);
	const undone = execute(current, restoreHistoryStep({ from: after, to: before }, current));
	expect(undone.junctions).toEqual([]);
	expect(undone.relations.map(({ id }) => id)).toEqual(['R']);
	expect(undone.nodes.map(({ id }) => id).sort()).toEqual(['A', 'B', 'C']);
});
