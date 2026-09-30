import { expect, it } from 'vitest';
import * as Y from 'yjs';

import {
	connectedNodeCreation,
	deletion,
	groupCreation,
	groupDissolution,
	groupFields,
	groupFoldToggle,
	groupStyleUpdate,
	junctionInsertion,
	junctionOperatorUpdate,
} from '../../../../src/app/web/document/document-commands';
import {
	EndpointKind,
	GroupState,
	JunctionOperator,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { executeSharedCommands } from '../../../../src/lib/infrastructure/collaboration/shared-command-executor';
import { importLogicDocument } from '../../../../src/lib/infrastructure/collaboration/yjs-document-codec';
import {
	SharedCommandKind as Op,
	type SharedDocumentCommand,
	SharedElementKind as Kind,
} from '../../../../src/lib/infrastructure/document/shared-document-command';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

/** G holds A, B and a nested group H holding junction J; C stays outside and points into G. */
function nestedGroups(): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'commands');
	return {
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
		nodes: [
			...model.nodes,
			{
				kind: EndpointKind.Node,
				id: 'C',
				natureId: 'N',
				markdown: 'Charlie',
				layoutOrder: orderKey('a5'),
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
		relations: [
			...model.relations,
			{ id: 'CJ', from: 'C', to: 'J' },
			{ id: 'CA', from: 'C', to: 'A' },
		],
	};
}

function execute(model: LogicDocument, commands: readonly SharedDocumentCommand[]): LogicDocument {
	const document = new Y.Doc();
	try {
		importLogicDocument(document, model);
		return executeSharedCommands(document, commands);
	} finally {
		document.destroy();
	}
}

it('deletes a group subtree after its incident relations and dissolves the emptied groups', () => {
	const model = nestedGroups();
	const commands = deletion(model, ['G'], []);

	const [first, ...rest] = commands;
	if (first?.op !== Op.DeleteRelations) throw new Error('Expected relations removed first');
	expect([...first.ids].sort()).toEqual(['CA', 'CJ', 'R']);
	expect(rest.some(({ op }) => op === Op.DeleteRelations)).toBe(false);
	// Removing J's relations already collects the junction; an explicit delete would be stale.
	expect(
		rest.some((command) => command.op === Op.Delete && command.target.kind === Kind.Junction),
	).toBe(false);
	const ungrouped: string[] = [];
	for (const command of rest) if (command.op === Op.Ungroup) ungrouped.push(command.id);
	expect(ungrouped).toEqual(['G', 'H']);

	const result = execute(model, commands);
	expect(result.nodes.map(({ id }) => id)).toEqual(['C']);
	expect(result.junctions).toEqual([]);
	expect(result.groups).toEqual([]);
	expect(result.relations).toEqual([]);
});

it('removes a relation selected with its endpoint only once', () => {
	const model = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'commands');
	const commands = deletion(model, ['B'], ['R']);

	expect(commands).toEqual([
		{ op: Op.DeleteRelations, ids: ['R'] },
		{ op: Op.Delete, target: { kind: Kind.Node, id: 'B' } },
	]);
	const result = execute(model, commands);
	expect(result.nodes.map(({ id }) => id)).toEqual(['A']);
	expect(result.relations).toEqual([]);
});

it('deletes a lone relation without touching its endpoints and proposes nothing for an empty selection', () => {
	const model = collaborativeFixture(CollaborativeFixture.LinkedBoxes, 'commands');

	expect(deletion(model, [], ['R'])).toEqual([{ op: Op.DeleteRelations, ids: ['R'] }]);
	expect(deletion(model, [], [])).toEqual([]);
});

function withJunctions(
	junctionIds: readonly string[],
	relations: LogicDocument['relations'],
): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'commands');
	return {
		...model,
		junctions: junctionIds.map((id, index) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`a${String(index + 2)}`),
		})),
		relations,
	};
}

it('deletes several lone junctions with a single explicit removal that collects the others', () => {
	const model = withJunctions(['J1', 'J2'], []);
	const commands = deletion(model, ['J1', 'J2'], []);

	expect(commands).toEqual([{ op: Op.Delete, target: { kind: Kind.Junction, id: 'J1' } }]);
	const result = execute(model, commands);
	expect(result.junctions).toEqual([]);
	expect(result.nodes.map(({ id }) => id)).toEqual(['A', 'B']);
});

it('removes a junction selected with its relations through relation removal alone', () => {
	const relations = [
		{ id: 'AJ', from: 'A', to: 'J' },
		{ id: 'JB', from: 'J', to: 'B' },
	];
	const model = withJunctions(['J'], relations);
	const commands = deletion(model, ['J'], ['AJ', 'JB']);

	expect(commands).toEqual([{ op: Op.DeleteRelations, ids: ['AJ', 'JB'] }]);
	const result = execute(model, commands);
	expect(result.junctions).toEqual([]);
	expect(result.relations).toEqual([]);
	expect(result.nodes.map(({ id }) => id)).toEqual(['A', 'B']);
});

it('creates a node before the relations that reference it, in one executable batch', () => {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'commands');
	const relations = [
		{ id: 'to-A', from: 'N1', to: 'A' },
		{ id: 'to-B', from: 'N1', to: 'B' },
	];
	const commands = connectedNodeCreation({ id: 'N1', natureId: 'N', markdown: 'New' }, relations);

	expect(commands[0]).toEqual({
		op: Op.Create,
		target: { kind: Kind.Node, id: 'N1' },
		properties: { natureId: 'N', markdown: 'New' },
	});
	expect(commands.slice(1)).toEqual(
		relations.map(({ id, from, to }) => ({
			op: Op.Create,
			target: { kind: Kind.Relation, id },
			properties: { from, to },
		})),
	);
	const result = execute(model, commands);
	expect(result.nodes.find(({ id }) => id === 'N1')).toMatchObject({
		natureId: 'N',
		markdown: 'New',
	});
	expect(result.relations).toEqual(relations);
});

it('groups siblings with a default name, then dissolves the group keeping its members', () => {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'commands');
	const grouped = execute(model, [groupCreation('G1', ['A', 'B'])]);
	expect(grouped.groups).toMatchObject([{ kind: EndpointKind.Group, id: 'G1', label: 'Groupe' }]);
	expect(grouped.nodes.map(({ groupId }) => groupId)).toEqual(['G1', 'G1']);

	const dissolved = execute(grouped, [groupDissolution('G1')]);
	expect(dissolved.groups).toEqual([]);
	expect(dissolved.nodes.map(({ id, groupId }) => [id, groupId])).toEqual([
		['A', undefined],
		['B', undefined],
	]);
});

it('sends the colour only when it changed, and clears it back to the default', () => {
	const model = nestedGroups();
	const group = model.groups.find(({ id }) => id === 'G');
	if (group === undefined) throw new Error('Expected group G');
	const base = groupFields(group);
	expect(base).toEqual({ label: group.label, color: group.color ?? '', laneId: '' });
	expect(groupStyleUpdate('G', base, { ...base, laneId: 'sales' })).toEqual({
		op: Op.Update,
		target: { kind: Kind.Group, id: 'G' },
		set: { laneId: 'sales' },
		unset: [],
	});

	expect(groupStyleUpdate('G', base, { ...base, label: 'Renamed' })).toBeUndefined();
	const coloured = groupStyleUpdate('G', base, { ...base, color: '#123456' });
	if (coloured === undefined) throw new Error('Expected a colour update');
	expect(execute(model, [coloured]).groups.find(({ id }) => id === 'G')?.color).toBe('#123456');
	const cleared = groupStyleUpdate('G', { ...base, color: '#123456' }, { ...base, color: '' });
	if (cleared === undefined) throw new Error('Expected a colour reset');
	expect(
		execute(execute(model, [coloured]), [cleared]).groups.find(({ id }) => id === 'G')?.color,
	).toBeUndefined();
});

it('toggles a group between closed and expanded from its current state', () => {
	const model = nestedGroups();
	const group = model.groups.find(({ id }) => id === 'G');
	if (group === undefined) throw new Error('Expected group G');
	const closed = execute(model, [groupFoldToggle(group)]);
	const closedGroup = closed.groups.find(({ id }) => id === 'G');
	expect(closedGroup?.state).toBe(GroupState.Closed);
	if (closedGroup === undefined) throw new Error('Expected the closed group');
	expect(
		execute(closed, [groupFoldToggle(closedGroup)]).groups.find(({ id }) => id === 'G')?.state,
	).toBe(GroupState.Expanded);
});

it('inserts a junction on a relation in one batch, then changes its operator', () => {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'commands');
	const inserted = execute(model, [
		...junctionInsertion({
			junction: { id: 'J', operator: JunctionOperator.Xor, groupId: 'G' },
			incoming: { id: 'BJ', from: 'B', to: 'J' },
			outgoing: { id: 'JA', from: 'J', to: 'A' },
			replacedRelationId: 'R',
		}),
	]);
	expect(inserted.junctions).toMatchObject([
		{ id: 'J', operator: JunctionOperator.Xor, groupId: 'G' },
	]);
	expect(inserted.relations.map(({ id, from, to }) => [id, from, to])).toEqual([
		['BJ', 'B', 'J'],
		['JA', 'J', 'A'],
	]);

	const updated = execute(inserted, [junctionOperatorUpdate('J', JunctionOperator.And)]);
	expect(updated.junctions.map(({ operator }) => operator)).toEqual([JunctionOperator.And]);
});

it('keeps a junction that feeds the replaced relation anchored through the new one', () => {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'commands');
	const withJunction = execute(model, [
		...junctionInsertion({
			junction: { id: 'J', operator: JunctionOperator.Xor, groupId: 'G' },
			incoming: { id: 'BJ', from: 'B', to: 'J' },
			outgoing: { id: 'JA', from: 'J', to: 'A' },
			replacedRelationId: 'R',
		}),
	]);
	// Splitting J → A: J keeps an outgoing relation at every step, so it is never collected.
	const twice = execute(withJunction, [
		...junctionInsertion({
			junction: { id: 'K', operator: JunctionOperator.Or, groupId: 'G' },
			incoming: { id: 'JK', from: 'J', to: 'K' },
			outgoing: { id: 'KA', from: 'K', to: 'A' },
			replacedRelationId: 'JA',
		}),
	]);
	expect(twice.junctions.map(({ id }) => id)).toEqual(['J', 'K']);
	expect(twice.relations.map(({ id }) => id)).toEqual(['BJ', 'JK', 'KA']);
});
