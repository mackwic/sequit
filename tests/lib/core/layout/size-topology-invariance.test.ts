import { describe, expect, it } from 'vitest';

import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import type { Size } from '../../../../src/lib/core/layout/layout-types';
import { layoutTopology } from '../../../support/assertions/layout-topology';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

interface Witness {
	readonly nodes: Readonly<Record<string, Size>>;
	/** Documentary order matters: relations keep the order they are listed in. */
	readonly relations: readonly string[];
	/** The one node whose content grows by 60 units, as when a label gets longer. */
	readonly widened: string;
}

/** The topology before and after a single node grows wider, in top-to-bottom. */
async function topologies({ nodes, relations, widened }: Witness) {
	const links = relations.map((id) => {
		const [from = '', to = ''] = id.split('-');
		return { id, from, to };
	});
	const before = defined(nodes[widened]);
	const wider = { ...nodes, [widened]: { ...before, width: before.width + 60 } };
	const direction = LayoutDirection.TopToBottom;
	return [
		layoutTopology(await layoutNodes({ direction, nodes, relations: links })),
		layoutTopology(await layoutNodes({ direction, nodes: wider, relations: links })),
	] as const;
}

describe('topology independent of node sizes', () => {
	it('keeps the topology of a fork and a convergence when one box grows', async () => {
		const size = { width: 200, height: 100 };
		const [before, after] = await topologies({
			nodes: { a: size, b: size, c: size, d: size },
			relations: ['a-b', 'a-c', 'b-d', 'c-d'],
			widened: 'b',
		});
		expect(after).toEqual(before);
	});

	// The complete 2 × 2 bipartite graph needs one crossing. Once d grows, the arrivals of a and b
	// on d run on columns 2 units apart; their rails used to be colored in the wrong order and
	// crossed each other twice, until rails of one family were nested (D-05).
	it('keeps one crossing in a complete 2 × 2 graph when a target grows', async () => {
		const [before, after] = await topologies({
			nodes: {
				a: { width: 200, height: 60 },
				b: { width: 160, height: 120 },
				c: { width: 300, height: 140 },
				d: { width: 240, height: 100 },
			},
			relations: ['a-c', 'b-d', 'a-d', 'b-c'],
			widened: 'd',
		});
		expect(after.crossings).toEqual(before.crossings);
	});

	// Known defect: the order of the rank c, d, e depends on the width of b, a box of another rank.
	it.fails('keeps the order of a rank when a box of another rank grows', async () => {
		const [before, after] = await topologies({
			nodes: {
				a: { width: 180, height: 160 },
				b: { width: 240, height: 120 },
				c: { width: 280, height: 120 },
				d: { width: 200, height: 100 },
				e: { width: 220, height: 80 },
			},
			relations: ['b-c', 'a-e', 'a-b', 'b-e', 'a-d'],
			widened: 'b',
		});
		expect(after.rows).toEqual(before.rows);
	});

	// Known defect: with the same rank orders and crossings, the arrival order on e depends on
	// the width of c, a box no route of e touches.
	it.fails('keeps the order of arrival ports when an unrelated box grows', async () => {
		const [before, after] = await topologies({
			nodes: {
				a: { width: 160, height: 120 },
				b: { width: 240, height: 100 },
				c: { width: 240, height: 140 },
				d: { width: 260, height: 140 },
				e: { width: 260, height: 100 },
			},
			relations: ['b-e', 'd-e', 'a-b', 'a-e', 'b-c'],
			widened: 'c',
		});
		expect(after.faces).toEqual(before.faces);
	});
});
