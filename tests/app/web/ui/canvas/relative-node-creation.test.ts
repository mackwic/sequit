import { describe, expect, it } from 'vitest';

import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	planRelativeNodeCreation,
	RelativeNodePosition,
} from '../../../../../src/app/web/ui/canvas/relative-node-creation';
import {
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import { validLogicDocument } from '../../../../support/builders/logic-document';

function ids(lastNatureId?: string) {
	let relation = 0;
	return { nodeId: 'new', relationId: () => `new-relation-${relation++}`, lastNatureId };
}

describe('relative node creation', () => {
	it('creates a child of a node with inherited nature and containment', () => {
		const document: LogicDocument = {
			...validLogicDocument(),
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'container',
					label: 'Container',
					layoutOrder: orderKey('a0'),
				},
			],
			natures: [
				{ id: 'first', label: 'First', color: '#111111' },
				{ id: 'inherited', label: 'Inherited', color: '#222222' },
			],
			nodes: [
				{
					kind: EndpointKind.Node,
					id: 'selected',
					natureId: 'inherited',
					groupId: 'container',
					markdown: 'Selected',
					layoutOrder: orderKey('a1'),
				},
			],
			junctions: [],
			relations: [],
		};

		expect(
			planRelativeNodeCreation(
				document,
				{ kind: EntityKind.Node, id: 'selected' },
				RelativeNodePosition.Child,
				ids('first'),
			),
		).toEqual({
			node: { id: 'new', natureId: 'inherited', markdown: '', groupId: 'container' },
			relations: [{ id: 'new-relation-0', from: 'new', to: 'selected' }],
		});
	});

	it('creates a graph child of a selected group beside that group in its container', () => {
		const document: LogicDocument = {
			...validLogicDocument(),
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'outer',
					label: 'Outer',
					layoutOrder: orderKey('a0'),
				},
				{
					kind: EndpointKind.Group,
					id: 'selected',
					label: 'Selected',
					groupId: 'outer',
					layoutOrder: orderKey('a1'),
				},
			],
			natures: [
				{ id: 'first', label: 'First', color: '#111111' },
				{ id: 'recent', label: 'Recent', color: '#222222' },
			],
			nodes: [],
			junctions: [],
			relations: [],
		};

		expect(
			planRelativeNodeCreation(
				document,
				{ kind: EntityKind.Group, id: 'selected' },
				RelativeNodePosition.Child,
				ids('recent'),
			),
		).toEqual({
			node: { id: 'new', natureId: 'recent', markdown: '', groupId: 'outer' },
			relations: [{ id: 'new-relation-0', from: 'new', to: 'selected' }],
		});
	});

	it('duplicates every parent for a junction sibling and falls back to the first nature', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'selected',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a0'),
				},
			],
			relations: [
				{ id: 'first-parent', from: 'selected', to: 'target' },
				{ id: 'second-parent', from: 'selected', to: 'endpoint-group' },
			],
		};

		const plan = planRelativeNodeCreation(
			document,
			{ kind: EntityKind.Junction, id: 'selected' },
			RelativeNodePosition.Sibling,
			ids('missing'),
		);
		expect(plan?.node.natureId).toBe(document.natures[0]?.id);
		expect(plan?.relations).toEqual([
			{ id: 'new-relation-0', from: 'new', to: 'target' },
			{ id: 'new-relation-1', from: 'new', to: 'endpoint-group' },
		]);
	});

	it('creates an unconnected root sibling and rejects unavailable targets or natures', () => {
		const document = validLogicDocument();
		expect(
			planRelativeNodeCreation(
				document,
				{ kind: EntityKind.Node, id: 'isolated' },
				RelativeNodePosition.Sibling,
				ids(),
			),
		).toMatchObject({ relations: [] });
		expect(
			planRelativeNodeCreation(
				document,
				{ kind: EntityKind.Relation, id: 'R' },
				RelativeNodePosition.Child,
				ids(),
			),
		).toBeUndefined();
		expect(
			planRelativeNodeCreation(
				{ ...document, natures: [] },
				{ kind: EntityKind.Junction, id: 'choice' },
				RelativeNodePosition.Child,
				ids(),
			),
		).toBeUndefined();
	});
});
