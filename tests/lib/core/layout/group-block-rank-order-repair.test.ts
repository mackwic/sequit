import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

describe('sibling block rank orders', () => {
	it('keeps the same sibling block order in every rank after a candidate permutation', () => {
		const base = validLogicDocument();
		const ids = ['a0', 'a1', 'b0', 'b1'];
		const groupById = new Map([
			['a0', 'A'],
			['a1', 'A'],
			['b0', 'B'],
			['b1', 'B'],
		]);
		const document: LogicDocument = {
			...base,
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			groups: ['A', 'B'].map((id, index) => ({
				kind: EndpointKind.Group,
				id,
				label: id,
				layoutOrder: orderKey(`a${index}`),
			})),
			junctions: [],
			nodes: ids.map((id, index) => ({
				kind: EndpointKind.Node,
				id,
				natureId: defined(base.natures[0]).id,
				markdown: id,
				layoutOrder: orderKey(`a${index + 2}`),
				groupId: defined(groupById.get(id)),
			})),
			relations: [
				{ id: 'a0-to-b1', from: 'a0', to: 'b1' },
				{ id: 'b0-to-a1', from: 'b0', to: 'a1' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const structure = prepareLayout(prepared.graph, prepared.ranks);
		const domain = collectRankOrderDomain(structure);
		const candidate = domain.bands.map((band, index) => {
			if (index === 0) return [...band];
			return [...band].reverse();
		});
		const reordered = applyRankOrder(structure, domain, candidate);
		const component = reordered.components.find(({ ids: componentIds }) =>
			componentIds.includes('a0'),
		);
		if (component === undefined) throw new Error('Missing connected block component');
		const orders = component.rows.ordinary
			.filter((row) => row.length === 2)
			.map((row) => row.map((id) => defined(groupById.get(id))));

		expect(orders).toEqual([
			['A', 'B'],
			['A', 'B'],
		]);
	});
});
