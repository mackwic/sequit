import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { barycentricSweep } from '../../../../src/lib/core/layout/rank/rank-order-heuristic';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

describe('group block barycentres', () => {
	it('moves a block toward the aggregate of relations crossing its frame', () => {
		const base = validLogicDocument();
		const document: LogicDocument = {
			...base,
			layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'g',
					label: 'Group',
					layoutOrder: orderKey('a0'),
				},
			],
			junctions: [],
			nodes: [
				['p0', 'a1'],
				['p2', 'a2'],
				['a', 'a3', 'g'],
				['x', 'a4'],
			].map(([id, key, groupId]) => {
				const node = {
					kind: EndpointKind.Node,
					id: defined(id),
					natureId: defined(base.natures[0]).id,
					markdown: defined(id),
					layoutOrder: orderKey(defined(key)),
				};
				if (groupId === undefined) return node;
				return { ...node, groupId };
			}),
			relations: [
				{ id: 'p0-a', from: 'p0', to: 'a' },
				{ id: 'p2-a', from: 'p2', to: 'a' },
				{ id: 'p0-x', from: 'p0', to: 'x' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const structure = prepareLayout(prepared.graph, prepared.ranks);
		const domain = collectRankOrderDomain(structure);
		const bandIndex = domain.bands.findIndex((band) => band.includes('g') && band.includes('x'));
		if (bandIndex < 0) throw new Error('Missing sibling block and node rank band');
		expect(barycentricSweep({ structure, domain }, domain.bands, true)[bandIndex]).toEqual([
			'x',
			'g',
		]);
	});
});
