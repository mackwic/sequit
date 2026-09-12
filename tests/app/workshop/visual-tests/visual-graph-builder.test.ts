import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { graphFixtures } from '../../../../src/app/workshop/visual-tests/fixtures/graph-fixtures';
import { VisualGraphBuilder } from '../../../../src/app/workshop/visual-tests/fixtures/visual-graph-builder';
import { defined } from '../../../../src/lib/core/document/logic-document';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

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
