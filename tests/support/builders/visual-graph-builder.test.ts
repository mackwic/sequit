import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { graphFixtures } from '../fixtures/graph-fixtures';
import { PROPERTY_PARAMETERS } from './property-test-options';
import { VisualGraphBuilder } from './visual-graph-builder';

const size = { width: 100, height: 60 };

it('distinguishes logical successors from explicit document arrows', () => {
	const data = new VisualGraphBuilder(size)
		.nodes(['a', 'b', 'c'])
		.successorsOf('a', ['b'])
		.relation({ id: 'explicit-arrow', from: 'a', to: 'c' })
		.build();
	expect(data.relations).toEqual([
		{ id: 'a-to-b', from: 'b', to: 'a' },
		{ id: 'explicit-arrow', from: 'a', to: 'c' },
	]);
});

it('composes named fixtures without changing their base topology', () => {
	const base = graphFixtures.threeSuccessors();
	const original = base.build();
	const extended = base.withIsolatedNode('e', { width: 200, height: 120 }).build();
	expect(Object.keys(original.nodes)).toEqual(['a', 'b', 'c', 'd']);
	expect(extended.nodes['e']).toEqual({ width: 200, height: 120 });
	expect(extended.relations).toEqual(original.relations);
	expect(graphFixtures.threeSuccessors().build()).toEqual(original);
	expect(graphFixtures.twoSuccessors().build().relations).toEqual(original.relations.slice(0, 2));
});

it('keeps snapshots deterministic and independent of input and output mutations', () => {
	fc.assert(
		fc.property(
			fc.record({
				width: fc.integer({ min: 1, max: 600 }),
				height: fc.integer({ min: 1, max: 300 }),
			}),
			(dimensions) => {
				const input = { ...dimensions };
				const relation = { id: 'b-a', from: 'b', to: 'a' };
				const builder = new VisualGraphBuilder(input).nodes(['a', 'b']).relation(relation);
				const first = builder.build();
				input.width += 10;
				relation.to = 'missing';
				const node = defined(first.nodes['a']);
				Object.assign(node, { width: 999 });
				Object.assign(defined(first.relations[0]), { from: 'missing' });
				const second = builder.nodes(['c']).build();
				expect(second.nodes).toEqual({ a: dimensions, b: dimensions, c: dimensions });
				expect(second.relations).toEqual([{ id: 'b-a', from: 'b', to: 'a' }]);
				expect(second).toEqual(builder.build());
				expect(Object.keys(first.nodes)).toEqual(['a', 'b']);
			},
		),
		PROPERTY_PARAMETERS,
	);
});

it.each([0, -1, NaN, Infinity])('rejects invalid dimensions %s', (value) => {
	expect(() => new VisualGraphBuilder({ width: value, height: 60 }).nodes(['a'])).toThrow(
		'dimensions',
	);
	expect(() => new VisualGraphBuilder(size).nodes(['a'], { width: 100, height: value })).toThrow(
		'dimensions',
	);
});

describe('stable identities and references', () => {
	it.each(['', ' ', 'a', 'edge'])('rejects an invalid or reused node ID %j', (id) => {
		const builder = new VisualGraphBuilder(size)
			.nodes(['a'])
			.relation({ id: 'edge', from: 'a', to: 'a' });
		expect(() => builder.nodes([id])).toThrow('node ID');
	});
	it.each(['', ' ', 'a', 'edge'])('rejects an invalid or reused relation ID %j', (id) => {
		const builder = new VisualGraphBuilder(size)
			.nodes(['a'])
			.relation({ id: 'edge', from: 'a', to: 'a' });
		expect(() => builder.relation({ id, from: 'a', to: 'a' })).toThrow('relation ID');
	});
	it.each([
		{ from: 'missing', to: 'a' },
		{ from: 'a', to: 'missing' },
	])('rejects missing endpoints: %j', (endpoints) => {
		const builder = new VisualGraphBuilder(size)
			.nodes(['a'])
			.relation({ id: 'edge', ...endpoints });
		expect(() => builder.build()).toThrow('missing node');
	});
	it.each([
		{ from: 'e', to: 'a' },
		{ from: 'a', to: 'e' },
	])('does not label a connected node as isolated: %j', (endpoints) => {
		const builder = new VisualGraphBuilder(size)
			.nodes(['a'])
			.relation({ id: 'edge', ...endpoints });
		expect(() => builder.withIsolatedNode('e')).toThrow('not isolated');
	});
});

it('keeps explicit arrows distinct from logical succession when composing builders', () => {
	const builder = new VisualGraphBuilder(size).nodes(['a', 'b', 'c']);
	const original = builder.arrowsFrom('a', ['b', 'c']).build();
	expect(original.relations).toEqual([
		{ id: 'a-to-b', from: 'a', to: 'b' },
		{ id: 'a-to-c', from: 'a', to: 'c' },
	]);
	expect(() => builder.arrowsFrom('a', ['b'])).toThrow('relation ID');
	expect(original.relations).toHaveLength(2);
});

it.each([
	[LayoutDirection.TopToBottom, 'width', 'height'],
	[LayoutDirection.BottomToTop, 'width', 'height'],
	[LayoutDirection.LeftToRight, 'height', 'width'],
	[LayoutDirection.RightToLeft, 'height', 'width'],
] as const)(
	'preserves transverse content and fresh routing variants in %s',
	(direction, transverse, primary) => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 600 }), (content) => {
				const base = graphFixtures.crossingRoutes(direction, content).build();
				const extended = graphFixtures
					.crossingRoutes(direction, content)
					.nodes(['e'])
					.arrowsFrom('c', ['e'])
					.build();
				expect(Object.keys(base.nodes)).toEqual(['a', 'b', 'c', 'd']);
				for (const dimensions of Object.values(extended.nodes)) {
					expect(dimensions[transverse]).toBe(content);
					expect(dimensions[primary]).toBe(60);
				}
				expect(extended.relations.slice(0, 4)).toEqual(base.relations);
				expect(graphFixtures.crossingRoutes(direction, content).build()).toEqual(base);
			}),
			PROPERTY_PARAMETERS,
		);
	},
);

it('keeps junction measurements independent and rejects endpoint identity collisions', () => {
	const builder = new VisualGraphBuilder(size)
		.nodes(['a', 'b'])
		.junctions(['j'])
		.successorsOf('a', ['j'])
		.successorsOf('j', ['b']);
	const first = builder.build();
	expect(first.junctions).toEqual({ j: { width: 28, height: 20 } });
	expect(Object.keys(first.nodes)).toEqual(['a', 'b']);
	Object.assign(defined(first.junctions?.['j']), { width: 999 });
	expect(builder.build().junctions?.['j']?.width).toBe(28);
	expect(() => builder.nodes(['j'])).toThrow('ID');
	expect(() => builder.junctions(['a'])).toThrow('ID');
	expect(() => builder.junctions(['j'])).toThrow('ID');
	expect(() => builder.relation({ id: 'j', from: 'a', to: 'b' })).toThrow('ID');
});
