import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph, type LogicGraph } from '../../../../src/lib/core/graph/create-graph';
import type { Bounds, Size } from '../../../../src/lib/core/layout/layout-types';
import { routeChannel } from '../../../../src/lib/core/layout/routing/channel-routing';
import type { ChannelRun } from '../../../../src/lib/core/layout/routing/channel-types';
import { allocatePorts } from '../../../../src/lib/core/layout/routing/port-allocation';
import { RelationPortOffsets } from '../../../../src/lib/core/layout/routing/relation-port-offsets';
import { crossingCorridors } from '../../../../src/lib/core/layout/routing/routing-corridors';
import { validLogicDocument } from '../../../support/builders/logic-document';

const DOCUMENTARY_IDS = ['a-first', 'z-second', 'm-cross'] as const;
const RENAMED_IDS = ['z-first', 'a-second', 'm-cross'] as const;

// Coincident measured centers force routing to resolve only its documentary-order tie.
const BOUNDS_BY_ID: Readonly<Record<string, Bounds>> = {
	'source-a': { x: -40, y: 120, width: 80, height: 60 },
	'source-b': { x: 60, y: 120, width: 80, height: 60 },
	'target-a': { x: 60, y: 0, width: 80, height: 60 },
	'target-b': { x: 60, y: 0, width: 80, height: 60 },
	'target-c': { x: -40, y: 0, width: 80, height: 60 },
};

const BOUNDS: ReadonlyMap<string, Bounds> = new Map(Object.entries(BOUNDS_BY_ID));
const RANKS_BY_ID: Readonly<Record<string, number>> = {
	'source-a': 1,
	'source-b': 1,
	'target-a': 0,
	'target-b': 0,
	'target-c': 0,
};
const RANKS: ReadonlyMap<string, number> = new Map(Object.entries(RANKS_BY_ID));
const SIZES: ReadonlyMap<string, Size> = new Map(
	Object.entries(BOUNDS_BY_ID).map(
		([id, bounds]) => [id, { width: bounds.width, height: bounds.height }] as const,
	),
);

function node(id: string, order: string) {
	return {
		kind: EndpointKind.Node,
		id,
		natureId: 'goal',
		markdown: id,
		layoutOrder: orderKey(order),
	};
}

function documentWithIds(ids: readonly [string, string, string]): LogicDocument {
	return {
		...validLogicDocument(),
		groups: [],
		junctions: [],
		nodes: [
			node('source-a', 'a0'),
			node('source-b', 'a1'),
			node('target-a', 'a2'),
			node('target-b', 'a3'),
			node('target-c', 'a4'),
		],
		relations: [
			{ id: ids[0], from: 'source-a', to: 'target-a' },
			{ id: ids[1], from: 'source-a', to: 'target-b' },
			{ id: ids[2], from: 'source-b', to: 'target-c' },
		],
	};
}

function graphOf(document: LogicDocument) {
	const result = createGraph(document);
	if (!result.ok) throw new Error('The routing-order document must form a graph.');
	return result.value;
}

function corridorsFor(graph: LogicGraph) {
	return crossingCorridors({ graph, ranks: RANKS, bounds: BOUNDS, vertical: true });
}

function corridorOrder(document: LogicDocument) {
	const graph = graphOf(document);
	return corridorsFor(graph).map(({ links }) =>
		links.map(({ relation }) => [relation.from, relation.to]),
	);
}

function center(id: string): number {
	const bounds = defined(BOUNDS.get(id));
	return bounds.x + bounds.width / 2;
}

function routeShape(run: ChannelRun | undefined) {
	if (run === undefined) return undefined;
	return { start: run.start, end: run.end, rail: run.rail };
}

function channelOrder(document: LogicDocument) {
	const graph = graphOf(document);
	const channel = routeChannel(
		graph.relations.map(({ relation }) => ({
			id: relation.id,
			source: center(relation.from),
			target: center(relation.to),
		})),
	);
	return channel.wires.map((wire) => {
		const relation = graph.relations.find(({ relation }) => relation.id === wire.id);
		if (relation === undefined) throw new Error('Every channel wire must name a relation.');
		return {
			from: relation.relation.from,
			to: relation.relation.to,
			first: routeShape(wire.first),
			last: routeShape(wire.last),
			middle: wire.middle,
		};
	});
}

function portOrder(document: LogicDocument) {
	const graph = graphOf(document);
	const ports = allocatePorts({
		corridors: corridorsFor(graph),
		graph,
		bounds: BOUNDS,
		sizes: SIZES,
		vertical: true,
	});
	return graph.relations.map(({ relation }) => ({
		from: relation.from,
		to: relation.to,
		source: ports.sourceOffsets.get(relation.id),
		target: ports.targetOffsets.get(relation.id),
	}));
}

function offsetOrder(document: LogicDocument) {
	const graph = graphOf(document);
	const offsets = new RelationPortOffsets(graph);
	for (const [index] of graph.relations.entries()) offsets.assign(index, index * 24);
	return graph.relations.map(({ relation }, index) => ({
		from: relation.from,
		to: relation.to,
		offset: offsets.get(relation.id),
		assigned: index * 24,
	}));
}

describe('dedicated routing follows documentary relation order', () => {
	it('keeps coincident corridor links in endpoint order after relation ids are renamed', () => {
		const expected = [
			[
				['source-a', 'target-a'],
				['source-a', 'target-b'],
				['source-b', 'target-c'],
			],
		];
		expect(corridorOrder(documentWithIds(DOCUMENTARY_IDS))).toEqual(expected);
		expect(corridorOrder(documentWithIds(RENAMED_IDS))).toEqual(expected);
	});

	it('keeps channel tracks attached to the same relations after ids are renamed', () => {
		const original = channelOrder(documentWithIds(DOCUMENTARY_IDS));
		expect(channelOrder(documentWithIds(RENAMED_IDS))).toEqual(original);
	});

	it('keeps face port offsets attached to the same relations after ids are renamed', () => {
		const original = portOrder(documentWithIds(DOCUMENTARY_IDS));
		expect(portOrder(documentWithIds(RENAMED_IDS))).toEqual(original);
	});

	it('looks up indexed port offsets by id in documentary relation order', () => {
		const original = offsetOrder(documentWithIds(DOCUMENTARY_IDS));
		expect(original).toEqual([
			{ from: 'source-a', to: 'target-a', offset: 0, assigned: 0 },
			{ from: 'source-a', to: 'target-b', offset: 24, assigned: 24 },
			{ from: 'source-b', to: 'target-c', offset: 48, assigned: 48 },
		]);
		expect(offsetOrder(documentWithIds(RENAMED_IDS))).toEqual(original);
	});
});
