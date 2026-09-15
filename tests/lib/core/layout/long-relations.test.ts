import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { quayPolicy } from '../../../support/fixtures/routing-fixtures';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';

const relations = [
	{ id: 'b-a', from: 'b', to: 'a' },
	{ id: 'c-b', from: 'c', to: 'b' },
	{ id: 'c-a', from: 'c', to: 'a' },
];

describe.each(LAYOUT_CONFIGURATIONS)(
	'ordinary long relations in $direction / $bias',
	({ direction, bias }) => {
		it('centers a straight chain and sends only its bypass to the positive side', async () => {
			const layout = await layoutNodes({
				nodes: {
					a: { width: 100, height: 50 },
					b: { width: 100, height: 50 },
					c: { width: 100, height: 50 },
				},
				relations,
				direction,
				bias,
			});
			const check = AssertLayout(layout);
			check.node('a').hasRank(1);
			check.node('b').hasRank(2);
			check.node('c').hasRank(3);
			check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
			check.obstacles().haveClearance(24);
			check.routes().haveNoCrossing();
			check.node('b').isAlignedWith('a', { by: 'chain' }).isAlignedWith('c', { by: 'chain' });
			for (const { id } of relations.slice(0, -1))
				check.route(id).isStraightAlong(axesFor(direction).primary);
			check.route('c-a').usesPositiveSideOf(layout.getById('b'), {
				axis: axesFor(direction).transverse,
				clearance: 24,
			});
		});

		it('moves only the bypass farther when a wide intermediate node needs more room', async () => {
			const nodes = {
				a: { width: 80, height: 80 },
				b: { width: 80, height: 80 },
				c: { width: 80, height: 80 },
			};
			const narrow = await layoutNodes({ nodes, relations, direction, bias });
			const wide = await layoutNodes({
				nodes: { ...nodes, b: { width: 360, height: 360 } },
				relations,
				direction,
				bias,
			});
			const check = AssertLayout(wide);
			check.obstacles().haveClearance(24);
			check.routes().haveNoCrossing().areAttachedToEndpoints().followLayoutFlow();
			check.node('b').isAlignedWith('a', { by: 'chain' }).isAlignedWith('c', { by: 'chain' });
			for (const { id } of relations.slice(0, -1))
				check.route(id).isStraightAlong(axesFor(direction).primary);
			check.route('c-a').usesPositiveSideOf(wide.getById('b'), {
				axis: axesFor(direction).transverse,
				clearance: 24,
			});
			const clearance = { spacing: 72, inset: quayPolicy.inset };
			check.quays('a', { side: 'incoming' }).haveCount(2).haveClearance(clearance);
			check.quays('c', { side: 'outgoing' }).haveCount(2).haveClearance(clearance);
			let dimension: 'width' | 'height' = 'width';
			if (axesFor(direction).transverse === 'y') dimension = 'height';
			for (const id of ['a', 'c'])
				expect(wide.getById(id).bounds[dimension]).toBe(narrow.getById(id).bounds[dimension]);
		});
	},
);

it('keeps unequal chains centered with a positive bypass regardless of IDs and input order', async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.array(
				fc.record({
					width: fc.integer({ min: 30, max: 300 }),
					height: fc.integer({ min: 20, max: 180 }),
				}),
				{ minLength: 3, maxLength: 7 },
			),
			fc.constantFrom(...LAYOUT_CONFIGURATIONS),
			fc.constantFrom('a-long', 'z-long'),
			async (sizes, { direction, bias }, longId) => {
				const ids = sizes.map((_, index) => String(index));
				const arrows = ids
					.slice(1)
					.map((id, index) => ({ id: `r${id}`, from: id, to: defined(ids[index]) }));
				arrows.push({ id: longId, from: defined(ids.at(-1)), to: '0' });
				const nodes = Object.fromEntries(ids.map((id, index) => [id, defined(sizes[index])]));
				const layout = await layoutNodes({ nodes, relations: arrows, direction, bias });
				const check = AssertLayout(layout);
				check.obstacles().haveClearance(24);
				check.routes().haveNoCrossing().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
				for (const { id } of arrows.slice(0, -1))
					check.route(id).isStraightAlong(axesFor(direction).primary);
				for (const id of ids.slice(1)) check.node(id).isAlignedWith('0', { by: 'chain' });
				check.route(longId).usesPositiveSideOf(layout.envelopeOf(ids.slice(1, -1)), {
					axis: axesFor(direction).transverse,
					clearance: 24,
				});
				for (const [index, id] of ids.entries()) check.node(id).hasRank(index + 1);
				const reversed = await layoutNodes({
					nodes,
					relations: arrows.toReversed(),
					direction,
					bias,
				});
				expect(reversed).toEqual(layout);
			},
		),
		PROPERTY_PARAMETERS,
	);
});
