import { describe, expect, it } from 'vitest';

import {
	hostsJunction,
	planJunctionInsertion,
} from '../../../../../src/app/web/ui/canvas/junction-insertion';
import { projectCollapsedDocument } from '../../../../../src/lib/core/document/collapsed-document';
import {
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
} from '../../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../../src/lib/core/document/order-key';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../../support/fixtures/collaborative-document';

function ids() {
	let next = 0;
	return {
		junctionId: 'J',
		relationId: () => `R${(next += 1)}`,
		operator: JunctionOperator.And,
	};
}

function document(): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.OpenGroup, 'junction');
	const [first] = model.nodes;
	if (first === undefined) throw new Error('Expected the fixture nodes');
	const root = { ...first, id: 'C', layoutOrder: orderKey('a3') };
	delete root.groupId;
	return {
		...model,
		nodes: [...model.nodes, root],
		relations: [...model.relations, { id: 'CA', from: 'C', to: 'A' }],
	};
}

describe('planJunctionInsertion', () => {
	it('threads the junction between the endpoints and drops the replaced relation last', () => {
		const plan = planJunctionInsertion(document(), 'R', ids());
		expect(plan).toEqual({
			junction: { id: 'J', operator: JunctionOperator.And, groupId: 'G' },
			incoming: { id: 'R1', from: 'B', to: 'J' },
			outgoing: { id: 'R2', from: 'J', to: 'A' },
			replacedRelationId: 'R',
		});
	});

	it('places the junction at the root when the endpoints share no group', () => {
		const plan = planJunctionInsertion(document(), 'CA', ids());
		expect(plan?.junction).toEqual({ id: 'J', operator: JunctionOperator.And });
	});

	it('places the junction in the deepest group common to both endpoints', () => {
		const model = document();
		const nested: LogicDocument = {
			...model,
			groups: [
				...model.groups,
				{
					kind: EndpointKind.Group,
					id: 'H',
					label: 'H',
					groupId: 'G',
					layoutOrder: orderKey('a4'),
				},
			],
			nodes: model.nodes.map((node) => {
				if (node.id === 'B') return { ...node, groupId: 'H' };
				return node;
			}),
		};
		expect(planJunctionInsertion(nested, 'R', ids())?.junction.groupId).toBe('G');
	});

	it('returns nothing for a relation the document no longer has', () => {
		expect(planJunctionInsertion(document(), 'gone', ids())).toBeUndefined();
	});
});

it('lets only a plain relation host a junction', () => {
	expect(hostsJunction({ canChangeFrom: true, canChangeTo: true })).toBe(true);
	expect(hostsJunction({ canChangeFrom: false, canChangeTo: true })).toBe(false);
	expect(hostsJunction({})).toBe(false);
});

it('refuses the arrow a folded group aggregates, since one of its source ends is hidden', () => {
	const visible = projectCollapsedDocument(document(), ['G']);
	const aggregated = visible.relations.get('CA');
	if (aggregated === undefined) throw new Error('Expected the aggregated arrow');
	expect(aggregated).toMatchObject({ canChangeFrom: true, canChangeTo: false });
	expect(hostsJunction(aggregated)).toBe(false);
});
