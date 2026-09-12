import fc from 'fast-check';
import { expect, it } from 'vitest';

import { defined, LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { junctionClearance, junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';

const direction = fc.constantFrom(...Object.values(LayoutDirection));
const size = fc.record({
	width: fc.integer({ min: 16, max: 240 }),
	height: fc.integer({ min: 16, max: 240 }),
});

it('keeps arbitrary junction chains on progressive rails without consuming node ranks', async () => {
	await fc.assert(
		fc.asyncProperty(
			direction,
			fc.array(size, { minLength: 1, maxLength: 20 }),
			async (direction, sizes) => {
				const ids = sizes.map((_, index) => `j${index}`);
				const input = junctionFixtures.chain(direction, ids).build();
				const junctions = Object.fromEntries(ids.map((id, index) => [id, defined(sizes[index])]));
				const data = { ...input, junctions, direction };
				const original = structuredClone(data);
				const layout = await layoutNodes(data);
				const check = AssertLayout(layout);
				check.node('a').hasRank(1);
				check.node('b').hasRank(2);
				check
					.junctions(ids)
					.areBetween(['a'], ['b'], junctionClearance)
					.areOnSeparateProgressiveRails(junctionClearance);
				for (const id of ids) check.junction(id).isAlignedWith('a', { by: 'chain' });
				check.obstacles().haveClearance(junctionClearance);
				check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
				expect(data).toEqual(original);
				const repeated = await layoutNodes({
					...data,
					relations: [...input.relations].reverse(),
					junctions: Object.fromEntries(Object.entries(junctions).reverse()),
				});
				expect(repeated.elements).toEqual(layout.elements);
				expect(repeated.relations).toEqual(layout.relations);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it('routes recursive row skips and junction crossings with unequal content sizes', async () => {
	await fc.assert(
		fc.asyncProperty(
			direction,
			fc.boolean(),
			fc.array(size, { minLength: 7, maxLength: 7 }),
			async (direction, crossing, sizes) => {
				let builder = junctionFixtures.recursiveDepths(direction);
				if (crossing) builder = junctionFixtures.crossing(direction);
				const input = builder.build();
				const nodes = Object.fromEntries(
					Object.keys(input.nodes).map((id, index) => [id, defined(sizes[index])]),
				);
				const junctions = Object.fromEntries(
					Object.keys(defined(input.junctions)).map((id, index) => [id, defined(sizes[index + 5])]),
				);
				const layout = await layoutNodes({ ...input, nodes, junctions, direction });
				const check = AssertLayout(layout);
				check
					.routes()
					.areOrthogonal()
					.areAttachedToEndpoints()
					.followLayoutFlow()
					.haveOnlyAllowedSharedTrunks();
				check.obstacles().haveClearance(junctionClearance);
				check.renderedPaths().haveBridgeAtEveryCrossing();
				const axis = axesFor(direction).transverse;
				for (const relation of layout.relations)
					for (const point of relation.points) {
						expect(point[axis]).toBeGreaterThanOrEqual(0);
						expect(point.x).toBeLessThanOrEqual(layout.width);
						expect(point.y).toBeLessThanOrEqual(layout.height);
					}
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it.each(Object.values(LayoutDirection))(
	'keeps disconnected node rows aligned around unequal junctions in %s',
	async (direction) => {
		const input = junctionFixtures
			.chain(direction, ['j1'], 144)
			.nodes(['c', 'd'])
			.junctions(['j2'])
			.successorsOf('c', ['j2'])
			.successorsOf('j2', ['d'])
			.build();
		const layout = await layoutNodes({ ...input, direction });
		const check = AssertLayout(layout);
		check.node('a').isAlignedWith('c', { by: 'row' });
		check.node('b').isAlignedWith('d', { by: 'row' });
		check.junctions(['j1', 'j2']).areOnSameRail();
		check.obstacles().haveClearance(junctionClearance);
	},
);

it('reserves passages for links that skip intermediate junctions without skipping logical ranks', async () => {
	await fc.assert(
		fc.asyncProperty(direction, fc.integer({ min: 3, max: 16 }), async (direction, length) => {
			const ids = Array.from({ length }, (_, index) => `j${index}`);
			const input = junctionFixtures
				.chain(direction, ids)
				.successorsOf('j0', [defined(ids.at(-1))])
				.build();
			const layout = await layoutNodes({ ...input, direction });
			const check = AssertLayout(layout);
			check.node('b').hasRank(2);
			check
				.junctions(ids)
				.areBetween(['a'], ['b'], junctionClearance)
				.areOnSeparateProgressiveRails(junctionClearance);
			check.obstacles().haveClearance(junctionClearance);
			check.routes().followLayoutFlow().haveOnlyAllowedSharedTrunks();
			check.renderedPaths().haveBridgeAtEveryCrossing();
		}),
		PROPERTY_PARAMETERS,
	);
});
