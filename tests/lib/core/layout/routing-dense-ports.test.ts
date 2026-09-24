import { expect, it } from 'vitest';

import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import type { Bounds } from '../../../../src/lib/core/layout/layout-types';
import { allocatePorts } from '../../../../src/lib/core/layout/routing/port-allocation';
import { validLogicDocument } from '../../../support/builders/logic-document';

it('keeps the same face slots when a dense corridor omits a direct link', () => {
	const source = validLogicDocument();
	const document = {
		...source,
		groups: [],
		junctions: [],
		nodes: source.nodes.map((node) => {
			const ungrouped = { ...node };
			delete ungrouped.groupId;
			return ungrouped;
		}),
		relations: [
			{ id: 'a-d', from: 'source-a', to: 'target' },
			{ id: 'a-e', from: 'source-a', to: 'isolated' },
			{ id: 'b-d', from: 'source-b', to: 'target' },
			{ id: 'b-e', from: 'source-b', to: 'isolated' },
		],
	};
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('Expected a valid dense graph');
	const bounds = new Map<string, Bounds>([
		['source-a', { x: 0, y: 120, width: 80, height: 60 }],
		['source-b', { x: 100, y: 120, width: 80, height: 60 }],
		['target', { x: 100, y: 0, width: 80, height: 60 }],
		['isolated', { x: 0, y: 0, width: 80, height: 60 }],
	]);
	const center = (id: string) => {
		const box = bounds.get(id);
		if (box === undefined) throw new Error(`Unknown box: ${id}`);
		return box.x + box.width / 2;
	};
	const links = graph.value.relations.map(({ relation }) => ({
		relation,
		source: center(relation.from),
		target: center(relation.to),
	}));
	const sizes = new Map([...bounds.keys()].map((id) => [id, { width: 80, height: 60 }]));
	const allocation = (corridorLinks: typeof links) =>
		allocatePorts({
			corridors: [{ rank: 0, links: corridorLinks }],
			sizes,
			vertical: true,
			graph: graph.value,
			bounds,
		});
	const full = allocation(links);
	const partial = allocation(links.filter(({ relation }) => relation.id !== 'b-e'));
	const reversed = allocation(links.toReversed());
	const faceSlots = (result: typeof full) => ({
		source: [...result.sourceOffsets].sort(),
		target: [...result.targetOffsets].sort(),
		demands: result.metricDemands,
		sizes: [...result.sizes].sort(),
	});
	expect(faceSlots(partial)).toEqual(faceSlots(full));
	expect(faceSlots(reversed)).toEqual(faceSlots(full));
	expect(full.sourceOffsets.get('a-e')).toBe(-24);
	expect(full.sourceOffsets.get('a-d')).toBe(24);
	expect(full.targetOffsets.get('a-d')).toBe(-24);
	expect(full.targetOffsets.get('b-d')).toBe(24);
	expect(full.hasSharedSourcePorts).toBe(false);
});
