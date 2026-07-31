import { describe, expect, it } from 'vitest';

import type { LogicDocument } from '../../src/lib/document/logic-document';
import type { LogicGraph } from '../../src/lib/graph/create-graph';
import { DEFAULT_UNBALANCED_RANDOM_SEED } from '../scenarios/layout-performance/builders/unbalanced-random-scenario';
import { prepareLayoutPerformanceScenario } from '../scenarios/layout-performance/prepare-layout-performance-scenario';
import type { LayoutPerformanceScenarioName } from '../scenarios/layout-performance/scenario-name';
import { LAYOUT_PERFORMANCE_SCENARIOS } from '../scenarios/layout-performance/scenarios';

function scenario(name: LayoutPerformanceScenarioName, nodeCount = 50) {
	const named = LAYOUT_PERFORMANCE_SCENARIOS.find((candidate) => candidate.name === name);
	if (!named) throw new Error(`Missing scenario: ${name}`);
	return prepareLayoutPerformanceScenario(named, nodeCount);
}

function predecessors(document: LogicDocument, id: string): readonly string[] {
	return document.relations.filter(({ to }) => to === id).map(({ from }) => from);
}

function itemAt<T>(items: readonly T[], index: number, name: string): T {
	const item = items[index];
	if (item === undefined) throw new Error(`Missing ${name} at index ${index}`);
	return item;
}

function weakComponentCount(graph: LogicGraph): number {
	const visited = new Set<string>();
	let count = 0;
	for (const start of graph.rankableEndpointIds) {
		if (visited.has(start)) continue;
		count += 1;
		const pending = [start];
		visited.add(start);
		while (pending.length > 0) {
			const id = pending.pop();
			if (!id) continue;
			for (const next of [
				...(graph.outgoingByEndpointId.get(id) ?? []),
				...(graph.predecessorsByEndpointId.get(id) ?? []),
			]) {
				if (!visited.has(next)) {
					visited.add(next);
					pending.push(next);
				}
			}
		}
	}
	return count;
}

describe('layout performance topologies', () => {
	it('builds a long queue with one node per rank', () => {
		const prepared = scenario('long-queue', 19);
		expect(prepared.nodeRanks.every((rank) => rank.length === 1)).toBe(true);
		for (let index = 1; index < prepared.document.nodes.length; index += 1) {
			expect(
				predecessors(prepared.document, itemAt(prepared.document.nodes, index, 'node').id),
			).toEqual([itemAt(prepared.document.nodes, index - 1, 'node').id]);
		}
	});

	it('builds a breadth-first binary tree', () => {
		const { document } = scenario('binary-tree');
		for (let index = 1; index < document.nodes.length; index += 1) {
			expect(predecessors(document, itemAt(document.nodes, index, 'node').id)).toEqual([
				itemAt(document.nodes, Math.floor((index - 1) / 2), 'parent node').id,
			]);
		}
		for (const node of document.nodes) {
			expect(document.relations.filter(({ from }) => from === node.id).length).toBeLessThanOrEqual(
				2,
			);
		}
	});

	it('builds prefix-stable 80-percent unbalanced ownership', () => {
		const prepared = scenario('unbalanced', 50);
		for (const node of prepared.document.nodes.slice(1)) {
			expect(predecessors(prepared.document, node.id)).toHaveLength(1);
		}
		for (let rank = 1; rank < prepared.nodeRanks.length - 1; rank += 1) {
			const source = itemAt(itemAt(prepared.nodeRanks, rank - 1, 'source rank'), 0, 'source');
			const target = itemAt(prepared.nodeRanks, rank, 'target rank');
			expect(target.filter((id) => predecessors(prepared.document, id)[0] === source)).toHaveLength(
				Math.ceil(target.length * 0.8),
			);
		}
	});

	it('records deterministic seeded dominant owners', () => {
		const first = scenario('unbalanced-random', 50);
		const second = scenario('unbalanced-random', 50);
		expect(first.metadata).toEqual(second.metadata);
		expect(first.metadata.seed).toBe(DEFAULT_UNBALANCED_RANDOM_SEED);
		const owners = first.metadata.dominantOwnerIds as Record<string, string>;
		expect(Object.keys(owners).length).toBe(first.nodeRanks.length - 1);
		expect(Object.values(owners)).toEqual([
			'node-0000000000000000',
			'node-0000000000000001',
			'node-0000000000000006',
			'node-0000000000000011',
			'node-0000000000000021',
			'node-0000000000000027',
			'node-0000000000000039',
		]);
		for (const [rank, owner] of Object.entries(owners)) {
			const rankIndex = Number(rank);
			const targets = itemAt(first.nodeRanks, rankIndex, 'target rank');
			expect(first.nodeRanks[rankIndex - 1]).toContain(owner);
			expect(
				targets.filter((target) => first.graph.predecessorsByEndpointId.get(target)?.[0] === owner),
			).toHaveLength(Math.min(targets.length, Math.ceil((rankIndex * 2 + 1) * 0.8)));
			for (const target of targets) {
				expect(first.graph.predecessorsByEndpointId.get(target)).toHaveLength(1);
				expect(first.ranks.byEndpointId.get(target)).toBe(rankIndex);
			}
		}
	});

	it('keeps ten percent of subgroup nodes at root and caps both groups', () => {
		const prepared = scenario('subgroups');
		const { document } = prepared;
		const rootNodes = document.nodes.filter(({ groupId }) => groupId === undefined);
		expect(rootNodes).toHaveLength(Math.ceil(document.nodes.length * 0.1));
		expect(document.groups).toHaveLength(2);
		expect(prepared.graph.rankableEndpointIds).toEqual(document.nodes.map(({ id }) => id));
		for (const group of document.groups) {
			const members = document.nodes.filter(({ groupId }) => group.id === groupId);
			expect(members.length).toBeLessThanOrEqual(Math.floor(document.nodes.length * 0.5));
			expect(prepared.graph.endpointsById.get(group.id)?.entity).toEqual(group);
			expect(prepared.measurements.groups.has(group.id)).toBe(true);
			for (const member of members) {
				expect(prepared.graph.endpointsById.get(member.id)?.entity).toEqual(member);
				expect(prepared.measurements.nodes.has(member.id)).toBe(true);
				expect(prepared.ranks.byEndpointId.get(member.id)).toBe(
					Math.floor(Math.log2(document.nodes.indexOf(member) + 1)),
				);
			}
		}
	});

	it('builds a nested group chain with one directly owned node per group', () => {
		const { document } = scenario('nested-subgroups', 19);
		expect(document.groups).toHaveLength(document.nodes.length);
		for (let index = 0; index < document.groups.length; index += 1) {
			const group = itemAt(document.groups, index, 'group');
			expect(itemAt(document.nodes, index, 'node').groupId).toBe(group.id);
			expect(group.groupId).toBe(
				index === 0 ? undefined : itemAt(document.groups, index - 1, 'parent group').id,
			);
		}
	});

	it('connects complete adjacent square-shell ranks', () => {
		const prepared = scenario('wide-bipartite-layers', 50);
		let expectedRelationCount = 0;
		for (let rank = 1; rank < prepared.nodeRanks.length; rank += 1) {
			const sources = itemAt(prepared.nodeRanks, rank - 1, 'source rank');
			const targets = itemAt(prepared.nodeRanks, rank, 'target rank');
			expectedRelationCount += sources.length * targets.length;
			for (const source of sources) {
				expect(prepared.graph.outgoingByEndpointId.get(source)).toEqual(targets);
			}
			for (const target of targets) {
				expect(predecessors(prepared.document, target)).toEqual(sources);
				expect(prepared.graph.predecessorsByEndpointId.get(target)).toEqual(sources);
				expect(prepared.ranks.byEndpointId.get(target)).toBe(rank);
			}
		}
		expect(prepared.document.relations).toHaveLength(expectedRelationCount);
		expect(prepared.graph.relations).toHaveLength(expectedRelationCount);
	});

	it('builds repeated diamonds with two-predecessor merges', () => {
		const { document } = scenario('repeated-diamonds', 19);
		for (let index = 1; index < document.nodes.length; index += 1) {
			expect(predecessors(document, itemAt(document.nodes, index, 'node').id)).toHaveLength(
				index % 3 === 0 ? 2 : 1,
			);
		}
	});

	it('partitions nodes into two-node chain components', () => {
		const prepared = scenario('disconnected-components', 19);
		expect(weakComponentCount(prepared.graph)).toBe(Math.ceil(prepared.nodeCount / 2));
		expect(prepared.document.relations).toHaveLength(Math.floor(prepared.nodeCount / 2));
	});

	it('alternates nodes and junctions using current one-rank-per-edge behavior', () => {
		const prepared = scenario('junction-heavy', 19);
		expect(prepared.document.junctions).toHaveLength(prepared.nodeCount - 1);
		expect(prepared.document.relations).toHaveLength((prepared.nodeCount - 1) * 2);
		for (let index = 0; index < prepared.nodeCount; index += 1) {
			expect(
				prepared.ranks.byEndpointId.get(itemAt(prepared.document.nodes, index, 'node').id),
			).toBe(index * 2);
			if (index < prepared.document.junctions.length) {
				const nodeId = itemAt(prepared.document.nodes, index, 'node').id;
				const junctionId = itemAt(prepared.document.junctions, index, 'junction').id;
				const nextNodeId = itemAt(prepared.document.nodes, index + 1, 'next node').id;
				expect(prepared.graph.outgoingByEndpointId.get(nodeId)).toEqual([junctionId]);
				expect(prepared.graph.outgoingByEndpointId.get(junctionId)).toEqual([nextNodeId]);
				expect(prepared.measurements.junctions.has(junctionId)).toBe(true);
				expect(prepared.ranks.byEndpointId.get(junctionId)).toBe(index * 2 + 1);
			}
		}
	});

	it('ranks populated group relations directly under current production semantics', () => {
		const prepared = scenario('group-relations', 50);
		expect(prepared.document.relations).toHaveLength(prepared.document.groups.length - 1);
		for (const node of prepared.document.nodes) {
			expect(prepared.ranks.byEndpointId.get(node.id)).toBe(0);
			expect(prepared.graph.outgoingByEndpointId.get(node.id)).toEqual([]);
		}
		for (let index = 0; index < prepared.document.groups.length; index += 1) {
			const group = itemAt(prepared.document.groups, index, 'group');
			const expectedOutgoing =
				index + 1 < prepared.document.groups.length
					? [itemAt(prepared.document.groups, index + 1, 'next group').id]
					: [];
			const expectedPredecessors =
				index === 0 ? [] : [itemAt(prepared.document.groups, index - 1, 'previous group').id];
			expect(prepared.graph.outgoingByEndpointId.get(group.id)).toEqual(expectedOutgoing);
			expect(prepared.graph.predecessorsByEndpointId.get(group.id)).toEqual(expectedPredecessors);
			expect(prepared.measurements.groups.has(group.id)).toBe(true);
			for (const member of prepared.document.nodes.filter(({ groupId }) => groupId === group.id)) {
				expect(prepared.graph.endpointsById.get(member.id)?.entity).toEqual(member);
			}
			expect(prepared.ranks.byEndpointId.get(group.id)).toBe(index);
		}
	});

	it('builds shallow, non-nested sibling groups with bounded direct membership', () => {
		const { document } = scenario('shallow-groups', 50);
		expect(document.groups.every(({ groupId }) => groupId === undefined)).toBe(true);
		for (const group of document.groups) {
			const members = document.nodes.filter(({ groupId }) => groupId === group.id);
			expect(members.length).toBeGreaterThan(0);
			expect(members.length).toBeLessThanOrEqual(10);
		}
		expect(document.nodes.filter(({ groupId }) => groupId === undefined)).toHaveLength(5);
	});
});
