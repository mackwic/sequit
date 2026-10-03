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
import { RankTopologyOracle } from '../../../../src/lib/core/layout/rank/rank-order-topology';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('repairs same-rank walls by lower-endpoint documentary position', () => {
	const base = validLogicDocument();
	const natureId = defined(base.nodes[0]).natureId;
	const nodeData: readonly [string, string, string | undefined][] = [
		['root', 'a0', undefined],
		['aTop', 'a1', 'A'],
		['cTop', 'a2', 'C'],
		['bTop', 'a3', 'B'],
		['s1', 'a4', 'A'],
		['s2', 'a5', 'C'],
		['bBottom', 'a6', 'B'],
		['t1', 'a7', undefined],
		['t2', 'a8', undefined],
		['sink', 'a9', undefined],
	];
	const nodes: LogicNode[] = nodeData.map(([id, key, groupId]) => {
		const node: LogicNode = {
			kind: EndpointKind.Node,
			id,
			natureId,
			markdown: id,
			layoutOrder: orderKey(key),
		};
		if (groupId === undefined) return node;
		return { ...node, groupId };
	});
	const document: LogicDocument = {
		...base,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups: [
			{ kind: EndpointKind.Group, id: 'A', label: 'A', layoutOrder: orderKey('a2') },
			{ kind: EndpointKind.Group, id: 'C', label: 'C', layoutOrder: orderKey('a1') },
			{ kind: EndpointKind.Group, id: 'B', label: 'Wall', layoutOrder: orderKey('a6') },
		],
		junctions: [],
		nodes,
		relations: [
			{ id: 'root-a', from: 'root', to: 'aTop' },
			{ id: 'root-c', from: 'root', to: 'cTop' },
			{ id: 'root-b', from: 'root', to: 'bTop' },
			{ id: 'a-span', from: 'aTop', to: 's1' },
			{ id: 'c-span', from: 'cTop', to: 's2' },
			{ id: 'b-span', from: 'bTop', to: 'bBottom' },
			{ id: 'r1', from: 'A', to: 't2' },
			{ id: 'r2', from: 'C', to: 't1' },
			{ id: 't1-sink', from: 't1', to: 'sink' },
			{ id: 't2-sink', from: 't2', to: 'sink' },
			{ id: 'b-sink', from: 'bBottom', to: 'sink' },
		],
	};
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Invalid documentary wall fixture');
	const structure = prepareLayout(graph.value, topologicallyRank(graph.value));
	const domain = collectRankOrderDomain(structure);
	const candidate = domain.bands.map((band) => {
		if (band.includes('t1')) return ['t1', 't2', 'B'];
		if (band.includes('B')) return ['B', 'A', 'C'];
		return ['A', 'C'];
	});
	const topology = new RankTopologyOracle(structure, domain);
	expect(topology.passages.closes(candidate)).toBe(true);
	expect(topology.passages.reopen(candidate)).toEqual({
		order: [
			['t1', 't2', 'B'],
			['A', 'C', 'B'],
			['A', 'C'],
		],
		closed: false,
	});
});
