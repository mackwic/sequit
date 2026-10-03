import { expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	type LogicNode,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import { searchDedicatedRankOrders } from '../../../../src/lib/core/layout/rank/rank-order-search';
import {
	applyRankOrder,
	collectRankOrderDomain,
} from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { fractionalOrderKeySpace } from '../../../../src/lib/core/ordering/order-key-space';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';

function groupedLayerDocument(masks: readonly number[]): LogicDocument {
	const base = validLogicDocument();
	const natureId = defined(base.nodes[0]).natureId;
	const ids = Array.from({ length: 16 }, (_, index) => `n${index}`);
	const orderKeys = new Map<string, string>();
	let previous: string | undefined;
	for (const id of ids) {
		let slot: { before?: string } = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		orderKeys.set(id, previous);
	}
	const nodes: LogicNode[] = ids.map((id, index) => {
		const node: LogicNode = {
			kind: EndpointKind.Node,
			id,
			natureId,
			markdown: id,
			layoutOrder: defined(orderKeys.get(id)),
		};
		if (index % 4 < 2) return { ...node, groupId: 'G' };
		return node;
	});
	const relations: LogicDocument['relations'][number][] = [];
	for (const [layer, mask] of masks.entries()) {
		for (let source = 0; source < 4; source += 1) {
			for (let target = 0; target < 4; target += 1) {
				if ((mask & (1 << (source * 4 + target))) === 0) continue;
				relations.push({
					id: `r${layer}-${source}-${target}`,
					from: `n${layer * 4 + source}`,
					to: `n${(layer + 1) * 4 + target}`,
				});
			}
		}
	}
	return {
		...base,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'G',
				label: 'Group',
				layoutOrder: orderKey('a0'),
			},
		],
		junctions: [],
		nodes,
		relations,
	};
}

it('finds the aligned grouped order with four alternating sweeps', () => {
	const document = groupedLayerDocument([19217, 15864, 9720]);
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Invalid sweep document');
	const structure = prepareLayout(graph.value, topologicallyRank(graph.value));
	const domain = collectRankOrderDomain(structure);
	const measurements = layoutMeasurementsFor(document, {
		nodes: Object.fromEntries(document.nodes.map(({ id }) => [id, { width: 80, height: 60 }])),
	});
	const baseline = evaluateDedicatedLayout(structure, measurements, undefined, true);
	const result = searchDedicatedRankOrders({
		structure,
		domain,
		measurements,
		baseline: { ...baseline, result: { ...baseline.result, width: 0 } },
		evaluate: (candidate) =>
			evaluateDedicatedLayout(
				applyRankOrder(structure, domain, candidate),
				measurements,
				undefined,
				true,
			),
		limits: { completePipelines: 12, uniqueProposals: 48 },
	});
	const selected = defined(result.selected);
	expect(selected.order[0]).toEqual(['G', 'n14', 'n15']);
	expect(selected.order[4]).toEqual(['G', 'n7', 'n6']);
});
