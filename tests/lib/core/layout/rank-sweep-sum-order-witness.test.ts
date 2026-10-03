import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { barycentricSweep } from '../../../../src/lib/core/layout/rank/rank-order-heuristic';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';

function relationOrderWitness() {
	const layout = layoutConfiguration(LayoutDirection.TopToBottom, LayoutBias.Top);
	if (layout === undefined) throw new Error('Missing layout configuration');
	const nodeIds = ['p1', 'p2', 'p3', 'p4', 'a', 'b', 'c'];
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rank-sweep-sum-order-witness',
		title: 'Rank sweep sum order witness',
		layout,
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		nodes: nodeIds.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
		})),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'z-inner',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a8'),
			},
			{
				kind: EndpointKind.Junction,
				id: 'z-outer',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a9'),
			},
		],
		relations: [
			{ id: 'p1-a', from: 'p1', to: 'a' },
			{ id: 'p2-a', from: 'p2', to: 'a' },
			{ id: 'p3-a', from: 'p3', to: 'a' },
			{ id: 'p1-outer', from: 'p1', to: 'z-outer' },
			{ id: 'p1-c', from: 'p1', to: 'c' },
			{ id: 'p2-inner', from: 'p2', to: 'z-inner' },
			{ id: 'p3-inner', from: 'p3', to: 'z-inner' },
			{ id: 'p4-c', from: 'p4', to: 'c' },
			{ id: 'inner-outer', from: 'z-inner', to: 'z-outer' },
			{ id: 'outer-b', from: 'z-outer', to: 'b' },
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid relation-order witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	return { domain, structure };
}

describe('rank sweep floating-point relation order', () => {
	it('uses documentary order when two items have the same three pulls through different paths', () => {
		const { domain, structure } = relationOrderWitness();
		expect(domain.bands).toEqual([
			['a', 'b', 'c'],
			['p1', 'p2', 'p3', 'p4'],
		]);
		// The direct path adds .2, .4, .6; the junction path visits .6, .4, .2.
		// Left-to-right floating-point addition differs by one ULP for those orders.

		const swept = barycentricSweep({ structure, domain }, domain.bands, true);
		expect(swept[0]).toEqual(['a', 'b', 'c']);
	});
});
