import fc from 'fast-check';
import { expect, it } from 'vitest';

import { defined, LAYOUT_DIRECTIONS } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { layoutTopology } from '../../../support/assertions/layout-topology';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';

const size = fc.record({
	width: fc.integer({ min: 7, max: 16 }).map((steps) => steps * 20),
	height: fc.integer({ min: 3, max: 8 }).map((steps) => steps * 20),
});

/** A small acyclic graph of plain nodes, with two independent sets of node sizes. */
const graphs = fc.integer({ min: 4, max: 9 }).chain((count) => {
	const ids = Array.from({ length: count }, (_, index) => `n${index}`);
	const sizes = fc.array(size, { minLength: count, maxLength: count });
	return fc
		.record({
			direction: fc.constantFrom(...LAYOUT_DIRECTIONS),
			sizes,
			resized: sizes,
			pairs: fc.uniqueArray(
				fc.tuple(fc.nat(count - 1), fc.nat(count - 1)).filter(([from, to]) => from < to),
				{ minLength: 1, maxLength: 2 * count, selector: ([from, to]) => `${from}:${to}` },
			),
		})
		.map(({ direction, sizes: first, resized, pairs }) => {
			const nodesOf = (values: typeof first) =>
				Object.fromEntries(ids.map((id, index) => [id, defined(values[index])]));
			return {
				direction,
				nodes: nodesOf(first),
				resized: nodesOf(resized),
				relations: pairs.map(([from, to]) => ({
					id: `n${from}-n${to}`,
					from: `n${from}`,
					to: `n${to}`,
				})),
			};
		});
});

it('never suggests an undrawn relation through shared ink', { timeout: 60_000 }, async () => {
	await fc.assert(
		fc.asyncProperty(graphs, async ({ direction, nodes, relations }) => {
			const layout = await layoutNodes({ direction, nodes, relations });
			AssertLayout(layout).routes().haveNoPhantomRelation();
		}),
		PROPERTY_PARAMETERS,
	);
});

// Known defect: node sizes decide the order of a rank, the ports of a face and which relations
// cross. Sizes should only be lower bounds of a topology decided from the graph.
it.fails(
	'keeps the same rank orders, ports and crossings whatever the node sizes',
	{ timeout: 60_000 },
	async () => {
		await fc.assert(
			fc.asyncProperty(graphs, async ({ direction, nodes, resized, relations }) => {
				const first = await layoutNodes({ direction, nodes, relations });
				const second = await layoutNodes({ direction, nodes: resized, relations });
				expect(layoutTopology(second)).toEqual(layoutTopology(first));
			}),
			{ ...PROPERTY_PARAMETERS, endOnFailure: true },
		);
	},
);
