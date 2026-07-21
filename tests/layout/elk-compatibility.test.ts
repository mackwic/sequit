import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';

interface PositionedShape {
	readonly id: string;
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

function findShape(
	root: ElkNode,
	id: string,
	parentX = 0,
	parentY = 0,
): PositionedShape | undefined {
	for (const child of root.children ?? []) {
		const x = parentX + (child.x ?? 0);
		const y = parentY + (child.y ?? 0);
		if (child.id === id) {
			return {
				id,
				x,
				y,
				width: child.width ?? 0,
				height: child.height ?? 0,
			};
		}
		const nested = findShape(child, id, x, y);
		if (nested) return nested;
	}
	return undefined;
}

function rankBand(shapes: readonly PositionedShape[]) {
	return {
		top: Math.min(...shapes.map(({ y }) => y)),
		bottom: Math.max(...shapes.map(({ y, height }) => y + height)),
	};
}

describe('ELK layered compatibility gate', () => {
	it('rejects ELK when hierarchical partitions do not form global rank bands', async () => {
		const elk = new ELK();
		const graph: ElkNode = {
			id: 'root',
			layoutOptions: {
				'elk.algorithm': 'org.eclipse.elk.layered',
				'elk.direction': 'UP',
				'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
				'org.eclipse.elk.partitioning.activate': 'true',
				'org.eclipse.elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
			},
			children: [
				{
					id: 'use-cases',
					layoutOptions: {
						'elk.padding': '[top=24,left=24,bottom=24,right=24]',
					},
					children: [
						{
							id: 'rank-0-a',
							width: 120,
							height: 60,
							layoutOptions: { 'org.eclipse.elk.partitioning.partition': '0' },
						},
						{
							id: 'rank-0-b',
							width: 120,
							height: 60,
							layoutOptions: { 'org.eclipse.elk.partitioning.partition': '0' },
						},
						{
							id: 'rank-1-a',
							width: 120,
							height: 60,
							layoutOptions: { 'org.eclipse.elk.partitioning.partition': '1' },
						},
						{
							id: 'rank-2-a',
							width: 120,
							height: 60,
							layoutOptions: { 'org.eclipse.elk.partitioning.partition': '2' },
						},
					],
					edges: [
						{ id: 'a-to-1', sources: ['rank-0-a'], targets: ['rank-1-a'] },
						{ id: 'b-to-1', sources: ['rank-0-b'], targets: ['rank-1-a'] },
						{ id: 'one-to-2', sources: ['rank-1-a'], targets: ['rank-2-a'] },
					],
				},
				{
					id: 'data-team',
					width: 120,
					height: 60,
					layoutOptions: { 'org.eclipse.elk.partitioning.partition': '0' },
				},
				{
					id: 'outside-rank-1',
					width: 120,
					height: 60,
					layoutOptions: { 'org.eclipse.elk.partitioning.partition': '1' },
				},
			],
			edges: [{ id: 'data-to-outside', sources: ['data-team'], targets: ['outside-rank-1'] }],
		};

		const output = await elk.layout(graph);
		const rank0 = ['rank-0-a', 'rank-0-b', 'data-team'].map((id) => findShape(output, id));
		const rank1 = ['rank-1-a', 'outside-rank-1'].map((id) => findShape(output, id));
		const rank2 = ['rank-2-a'].map((id) => findShape(output, id));
		expect(rank0.every(Boolean)).toBe(true);
		expect(rank1.every(Boolean)).toBe(true);
		expect(rank2.every(Boolean)).toBe(true);
		const bands = [rank0, rank1, rank2].map((rank) =>
			rankBand(rank.filter((shape): shape is PositionedShape => shape !== undefined)),
		);

		const hasOrderedGlobalBands =
			(bands[1]?.bottom ?? Number.POSITIVE_INFINITY) <
				(bands[0]?.top ?? Number.NEGATIVE_INFINITY) &&
			(bands[2]?.bottom ?? Number.POSITIVE_INFINITY) < (bands[1]?.top ?? Number.NEGATIVE_INFINITY);
		expect(hasOrderedGlobalBands).toBe(false);
		expect(findShape(output, 'use-cases')).toMatchObject({ id: 'use-cases' });
		expect(findShape(output, 'data-team')).toMatchObject({
			id: 'data-team',
			width: 120,
			height: 60,
		});
	});
});
