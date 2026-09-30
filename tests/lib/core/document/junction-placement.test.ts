import { expect, it } from 'vitest';

import { placeJunctions } from '../../../../src/lib/core/document/junction-placement';
import {
	EndpointKind,
	JunctionOperator,
	type LogicDocument,
	type LogicNode,
	type LogicRelation,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	CollaborativeFixture,
	collaborativeFixture,
} from '../../../support/fixtures/collaborative-document';

interface Member {
	readonly groupId?: string;
	readonly laneId?: string;
}

/** Boxes A and B at the root feed J; P and Q are placed by `members`, H nests in G. */
function document(
	relations: readonly LogicRelation[],
	members: Readonly<Record<string, Member>>,
	junctionIds: readonly string[] = ['J'],
): LogicDocument {
	const model = collaborativeFixture(CollaborativeFixture.TwoBoxes, 'placement');
	const boxes = ['P', 'Q'].map((id, index): LogicNode => ({
		kind: EndpointKind.Node,
		id,
		natureId: 'N',
		markdown: id,
		layoutOrder: orderKey(`a${String(index + 2)}`),
		...members[id],
	}));
	return {
		...model,
		groups: ['G', 'H'].map((id, index) => ({
			kind: EndpointKind.Group,
			id,
			label: id,
			layoutOrder: orderKey(`a${String(index + 4)}`),
			...members[id],
		})),
		nodes: [...model.nodes, ...boxes],
		junctions: junctionIds.map((id, index) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(`a${String(index + 6)}`),
			...members[id],
		})),
		relations,
	};
}

const intoP: readonly LogicRelation[] = [
	{ id: 'AJ', from: 'A', to: 'J' },
	{ id: 'BJ', from: 'B', to: 'J' },
	{ id: 'JP', from: 'J', to: 'P' },
];
function placement(result: LogicDocument, id: string): Member | undefined {
	const junction = result.junctions.find((candidate) => candidate.id === id);
	if (junction === undefined) return undefined;
	const fields: { groupId?: string; laneId?: string } = {};
	if (junction.groupId !== undefined) fields.groupId = junction.groupId;
	if (junction.laneId !== undefined) fields.laneId = junction.laneId;
	return fields;
}

it('puts the junction in its target’s group, whatever group its sources are in', () => {
	const grouped = document(intoP, { P: { groupId: 'G' } });
	expect(placement(placeJunctions(grouped), 'J')).toEqual({ groupId: 'G' });

	const left = document(intoP, { J: { groupId: 'G' } });
	expect(placement(placeJunctions(left), 'J')).toEqual({});
});

it('keeps the junction out of a group as soon as one of its targets is outside it', () => {
	const split = [...intoP, { id: 'JQ', from: 'J', to: 'Q' }];
	expect(placement(placeJunctions(document(split, { P: { groupId: 'G' } })), 'J')).toEqual({});

	const nested = document(split, {
		H: { groupId: 'G' },
		P: { groupId: 'H' },
		Q: { groupId: 'G' },
	});
	expect(placement(placeJunctions(nested), 'J')).toEqual({ groupId: 'G' });
});

it('places a chain of junctions from the target back', () => {
	const chain = document(
		[
			{ id: 'AJ', from: 'A', to: 'J' },
			{ id: 'JK', from: 'J', to: 'K' },
			{ id: 'KP', from: 'K', to: 'P' },
		],
		{ P: { groupId: 'G' } },
		['J', 'K'],
	);
	const result = placeJunctions(chain);
	expect(placement(result, 'J')).toEqual({ groupId: 'G' });
	expect(placement(result, 'K')).toEqual({ groupId: 'G' });
});

it('gives a root junction its targets’ lane, keeping its own while a target offers it', () => {
	const inLane = document(intoP, { J: { groupId: 'G' }, P: { laneId: 'right' } });
	expect(placement(placeJunctions(inLane), 'J')).toEqual({ laneId: 'right' });

	const split = [...intoP, { id: 'JQ', from: 'J', to: 'Q' }];
	const lanes = document(split, {
		J: { laneId: 'right' },
		P: { laneId: 'left' },
		Q: { laneId: 'right' },
	});
	expect(placeJunctions(lanes)).toBe(lanes);
});
