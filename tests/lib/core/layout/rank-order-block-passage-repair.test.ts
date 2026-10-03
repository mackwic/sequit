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
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import {
	topologicallyRank,
	type TopologicalRanks,
} from '../../../../src/lib/core/graph/topological-ranks';
import { evaluateDedicatedLayout } from '../../../../src/lib/core/layout/layout-engine';
import type {
	DedicatedLayoutEvaluation,
	LayoutMeasurements,
} from '../../../../src/lib/core/layout/layout-types';
import type { RankOrder } from '../../../../src/lib/core/layout/rank/rank-order';
import { searchDedicatedRankOrders } from '../../../../src/lib/core/layout/rank/rank-order-search';
import { RankTopologyOracle } from '../../../../src/lib/core/layout/rank/rank-order-topology';
import {
	collectRankOrderDomain,
	type RankOrderDomain,
} from '../../../../src/lib/core/layout/rank/rank-ordering';
import {
	type LayoutStructure,
	prepareLayout,
} from '../../../../src/lib/core/layout/structure/prepare-layout';
import { layoutMeasurementsFor } from '../../../support/builders/layout-measurements';
import { validLogicDocument } from '../../../support/builders/logic-document';

interface PassageFixture {
	readonly document: LogicDocument;
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly structure: LayoutStructure;
	readonly domain: RankOrderDomain;
	readonly topology: RankTopologyOracle;
	readonly measurements: LayoutMeasurements;
	readonly baseline: DedicatedLayoutEvaluation;
}

function passageFixture(targetIsFixed: boolean): PassageFixture {
	const base = validLogicDocument();
	const natureId = defined(base.nodes[0]).natureId;
	const nodeIds = ['root', 'upper', 'block-upper', 'block-lower'];
	if (!targetIsFixed) nodeIds.push('lower');
	const nodes: LogicNode[] = nodeIds.map((id, index) => {
		const node: LogicNode = {
			kind: EndpointKind.Node,
			id,
			natureId,
			markdown: id,
			layoutOrder: orderKey(`a${index + 1}`),
		};
		if (id.startsWith('block-')) return { ...node, groupId: 'B' };
		return node;
	});
	const groups: LogicDocument['groups'][number][] = [
		{
			kind: EndpointKind.Group,
			id: 'B',
			label: 'Block',
			layoutOrder: orderKey('a4'),
		},
	];
	let target = 'lower';
	if (targetIsFixed) {
		target = 'G';
		groups.push({
			kind: EndpointKind.Group,
			id: 'G',
			label: 'Empty target',
			layoutOrder: orderKey('a0'),
		});
	}
	const document: LogicDocument = {
		...base,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups,
		junctions: [],
		nodes,
		relations: [
			{ id: 'root-target', from: 'root', to: target },
			{ id: 'root-block', from: 'root', to: 'block-upper' },
			{ id: 'target-upper', from: target, to: 'upper' },
			{ id: 'block-span', from: 'block-upper', to: 'block-lower' },
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid block-passage fixture');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	const topology = new RankTopologyOracle(structure, domain);
	const measurements = layoutMeasurementsFor(document);
	const baseline = evaluateDedicatedLayout(structure, measurements, undefined, true);
	return {
		document,
		graph,
		ranks,
		structure,
		domain,
		topology,
		measurements,
		baseline,
	};
}

function invalidBaseline(fixture: PassageFixture) {
	return {
		...fixture.baseline,
		result: { ...fixture.baseline.result, width: 0 },
	};
}

interface SiblingBlocksFixture {
	readonly domain: RankOrderDomain;
	readonly topology: RankTopologyOracle;
}

function siblingBlocksFixture(): SiblingBlocksFixture {
	const base = validLogicDocument();
	const natureId = defined(base.nodes[0]).natureId;
	const groups: LogicDocument['groups'] = ['A', 'B'].map((id, index) => ({
		kind: EndpointKind.Group,
		id,
		label: id,
		layoutOrder: orderKey(`a${index}`),
	}));
	const nodes: LogicNode[] = ['root', 'a-top', 'a-bottom', 'b-top', 'b-bottom'].map((id, index) => {
		let groupId: string | undefined;
		if (id.startsWith('a-')) groupId = 'A';
		else if (id.startsWith('b-')) groupId = 'B';
		const node: LogicNode = {
			kind: EndpointKind.Node,
			id,
			natureId,
			markdown: id,
			layoutOrder: orderKey(`a${index + 2}`),
		};
		if (groupId === undefined) return node;
		return { ...node, groupId };
	});
	const document: LogicDocument = {
		...base,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		groups,
		junctions: [],
		nodes,
		relations: [
			{ id: 'root-a', from: 'root', to: 'a-top' },
			{ id: 'root-b', from: 'root', to: 'b-top' },
			{ id: 'a-span', from: 'a-top', to: 'a-bottom' },
			{ id: 'b-span', from: 'b-top', to: 'b-bottom' },
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid sibling-block fixture');
	const graph = created.value;
	const structure = prepareLayout(graph, topologicallyRank(graph));
	const domain = collectRankOrderDomain(structure);
	return { domain, topology: new RankTopologyOracle(structure, domain) };
}

it('aligns sibling blocks in every band when reopening an unaligned order', () => {
	const fixture = siblingBlocksFixture();
	const candidate: RankOrder = [
		['A', 'B'],
		['B', 'A'],
	];
	expect(fixture.topology.passages.reopen(candidate).order).toEqual([
		['A', 'B'],
		['A', 'B'],
	]);
});

it('repairs a proposed order before giving its reopened form to the evaluator', () => {
	const fixture = passageFixture(false);
	const reopened = fixture.topology.passages.reopen([
		['B', 'upper'],
		['lower', 'B'],
	]);
	expect(reopened).toEqual({
		order: [
			['B', 'upper'],
			['B', 'lower'],
		],
		closed: false,
	});
	const evaluated: RankOrder[] = [];
	searchDedicatedRankOrders({
		structure: fixture.structure,
		domain: fixture.domain,
		measurements: fixture.measurements,
		baseline: invalidBaseline(fixture),
		evaluate: (order) => {
			evaluated.push(order);
			return fixture.baseline;
		},
		limits: { completePipelines: 2, uniqueProposals: 2 },
	});
	expect(evaluated).toEqual([reopened.order]);
});

it('counts but does not evaluate an order whose fixed endpoint leaves its passage closed', () => {
	const fixture = passageFixture(true);
	const closed: RankOrder = [['B', 'upper']];
	expect(fixture.topology.passages.reopen(closed)).toEqual({
		order: closed,
		closed: true,
	});
	let evaluations = 0;
	const result = searchDedicatedRankOrders({
		structure: fixture.structure,
		domain: fixture.domain,
		measurements: fixture.measurements,
		baseline: invalidBaseline(fixture),
		evaluate: () => {
			evaluations += 1;
			return fixture.baseline;
		},
		limits: { completePipelines: 4, uniqueProposals: 4 },
	});
	expect(evaluations).toBe(0);
	expect(result.witness).toMatchObject({
		mode: 'exact',
		proposed: 2,
		evaluated: 1,
	});
});
