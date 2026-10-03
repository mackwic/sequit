import { expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

function wallMembership(id: string): { readonly groupId?: string } {
	if (id === 'b' || id === 'c') return { groupId: 'wall' };
	return {};
}
function wallWitness(): LogicDocument {
	const base = validLogicDocument();
	return {
		...base,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'wall',
				label: 'Wall',
				layoutOrder: orderKey('a0'),
			},
		],
		junctions: [],
		nodes: ['a', 'b', 'c', 'd'].map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: defined(base.natures[0]).id,
			markdown: id,
			layoutOrder: orderKey(`a${index + 1}`),
			...wallMembership(id),
		})),
		relations: [
			{ id: 'wall-spans-rows', from: 'b', to: 'c' },
			{ id: 'wall-joins-component', from: 'b', to: 'd' },
			{ id: 'neighbour-relation', from: 'a', to: 'd' },
		],
	};
}

it('keeps a cross-row relation on the same side of a continuing block wall', () => {
	const prepared = prepareLayoutDocument(wallWitness());
	const structure = prepareLayout(prepared.graph, prepared.ranks);
	const component = defined(structure.components.find(({ ids }) => ids.includes('a')));
	const upper = defined(component.rows.ordinary[0]);
	const lower = defined(component.rows.ordinary[1]);
	const side = (row: readonly string[], item: string, wallMember: string): number =>
		Math.sign(row.indexOf(item) - row.indexOf(wallMember));

	expect(side(upper, 'd', 'c')).toBe(side(lower, 'a', 'b'));
});
