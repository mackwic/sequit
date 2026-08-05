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
function stringRecord(value: unknown, name: string): Readonly<Record<string, string>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`Expected ${name} to be a record`);
	}
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== 'string') throw new TypeError(`Expected ${name}.${key} to be a string`);
		record[key] = entry;
	}
	return record;
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
			if (id === undefined) continue;
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
		expect(first.metadata['seed']).toBe(DEFAULT_UNBALANCED_RANDOM_SEED);
		const owners = stringRecord(first.metadata['dominantOwnerIds'], 'dominantOwnerIds');
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
			let expectedParentId: string | undefined;
			if (index > 0) expectedParentId = itemAt(document.groups, index - 1, 'parent group').id;
			expect(group.groupId).toBe(expectedParentId);
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
			let predecessorCount = 1;
			if (index % 3 === 0) predecessorCount = 2;
			expect(predecessors(document, itemAt(document.nodes, index, 'node').id)).toHaveLength(
				predecessorCount,
			);
		}
	});

	it('partitions nodes into two-node chain components', () => {
		const prepared = scenario('disconnected-components', 19);
		expect(weakComponentCount(prepared.graph)).toBe(Math.ceil(prepared.nodeCount / 2));
		expect(prepared.document.relations).toHaveLength(Math.floor(prepared.nodeCount / 2));
	});

	it('keeps junctions in their source rank', () => {
		const prepared = scenario('junction-heavy', 19);
		expect(prepared.document.junctions).toHaveLength(prepared.nodeCount - 1);
		expect(prepared.document.relations).toHaveLength((prepared.nodeCount - 1) * 2);
		for (let index = 0; index < prepared.nodeCount; index += 1) {
			expect(
				prepared.ranks.byEndpointId.get(itemAt(prepared.document.nodes, index, 'node').id),
			).toBe(index);
			if (index < prepared.document.junctions.length) {
				const nodeId = itemAt(prepared.document.nodes, index, 'node').id;
				const junctionId = itemAt(prepared.document.junctions, index, 'junction').id;
				const nextNodeId = itemAt(prepared.document.nodes, index + 1, 'next node').id;
				expect(prepared.graph.outgoingByEndpointId.get(nodeId)).toEqual([junctionId]);
				expect(prepared.graph.outgoingByEndpointId.get(junctionId)).toEqual([nextNodeId]);
				expect(prepared.measurements.junctions.has(junctionId)).toBe(true);
				expect(prepared.ranks.byEndpointId.get(junctionId)).toBe(index);
			}
		}
	});

	it('expands populated group relations across their members', () => {
		const prepared = scenario('group-relations', 50);
		expect(prepared.document.relations).toHaveLength(prepared.document.groups.length - 1);
		for (let index = 0; index < prepared.document.groups.length; index += 1) {
			const group = itemAt(prepared.document.groups, index, 'group');
			const members = prepared.document.nodes.filter(({ groupId }) => groupId === group.id);
			let expectedOutgoing: string[] = [];
			if (index + 1 < prepared.document.groups.length) {
				const nextGroup = itemAt(prepared.document.groups, index + 1, 'next group');
				expectedOutgoing = prepared.document.nodes
					.filter(({ groupId }) => groupId === nextGroup.id)
					.map(({ id }) => id);
			}
			let expectedPredecessors: string[] = [];
			if (index > 0) {
				const previousGroup = itemAt(prepared.document.groups, index - 1, 'previous group');
				expectedPredecessors = prepared.document.nodes
					.filter(({ groupId }) => groupId === previousGroup.id)
					.map(({ id }) => id);
			}
			expect(prepared.measurements.groups.has(group.id)).toBe(true);
			for (const member of members) {
				expect(prepared.graph.endpointsById.get(member.id)?.entity).toEqual(member);
				expect(prepared.graph.outgoingByEndpointId.get(member.id)).toEqual(expectedOutgoing);
				expect(prepared.graph.predecessorsByEndpointId.get(member.id)).toEqual(
					expectedPredecessors,
				);
				expect(prepared.ranks.byEndpointId.get(member.id)).toBe(index);
			}
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
