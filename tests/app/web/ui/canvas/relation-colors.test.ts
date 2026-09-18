import { describe, expect, it } from 'vitest';

import type { LayoutRelation } from '../../../../../src/app/web/projection/layout-graph';
import {
	parallelSegmentsAreClose,
	relationColors,
} from '../../../../../src/app/web/ui/canvas/relation-colors';

function relation(id: string, from: string, to: string, offset = 0): LayoutRelation {
	return {
		id,
		from,
		to,
		points: [
			{ x: offset, y: 0 },
			{ x: offset, y: 50 },
			{ x: 100, y: 50 },
			{ x: 100, y: 100 },
		],
	};
}

describe('relationColors', () => {
	it('keeps shared departure and arrival ports in one color, including merged families', () => {
		const relations = [
			relation('a', 'one', 'first'),
			relation('b', 'two', 'second'),
			relation('c', 'one', 'second'),
			relation('d', 'two', 'third'),
		];
		const colors = relationColors(relations);
		expect(new Set(colors.values()).size).toBe(1);
		expect(relationColors([...relations].reverse())).toEqual(colors);
	});

	it('reuses one color for unrelated routes without crossings', () => {
		const colors = relationColors([
			relation('a', 'one', 'first'),
			relation('b', 'one', 'second', 20),
			relation('c', 'two', 'third'),
			relation('d', 'three', 'fourth'),
			relation('e', 'four', 'fifth'),
		]);
		expect(new Set(colors.values())).toEqual(new Set(['var(--content-relation-1)']));
	});

	it('distinguishes crossing families while preserving shared trunks', () => {
		const relations = [
			relation('a', 'one', 'first'),
			relation('b', 'two', 'second'),
			relation('c', 'one', 'third'),
		];
		const colors = relationColors(relations, [['a', 'b']]);
		expect(colors.get('a')).not.toBe(colors.get('b'));
		expect(colors.get('a')).toBe(colors.get('c'));
		expect(relationColors(relations.toReversed(), [['b', 'a']])).toEqual(colors);
	});
	it('distributes the palette round robin inside one transitive contact cluster', () => {
		const relations = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => relation(id, id, id));
		const crossings = relations.flatMap((first, index) =>
			relations.slice(index + 1).map((second): readonly [string, string] => [first.id, second.id]),
		);
		const colors = relationColors(relations, crossings);
		expect([...colors.values()]).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-2)',
			'var(--content-relation-3)',
			'var(--content-relation-4)',
			'var(--content-relation-5)',
			'var(--content-relation-6)',
			'var(--content-relation-7)',
			'var(--content-relation-1)',
		]);
		expect(relationColors(relations.toReversed(), crossings.toReversed())).toEqual(colors);
	});

	it('restarts the palette for independent contact clusters', () => {
		const relations = ['a', 'b', 'c', 'd', 'e'].map((id) => relation(id, id, id));
		const colors = relationColors(relations, [
			['a', 'b'],
			['d', 'e'],
		]);
		expect([...colors.values()]).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-2)',
			'var(--content-relation-1)',
			'var(--content-relation-1)',
			'var(--content-relation-2)',
		]);
	});

	it('accepts a custom ordered palette', () => {
		const relations = ['a', 'b', 'c'].map((id) => relation(id, id, id));
		const colors = relationColors(
			relations,
			[
				['a', 'b'],
				['b', 'c'],
			],
			['ink', 'accent'],
		);
		expect([...colors.values()]).toEqual(['ink', 'accent', 'ink']);
	});

	it('propagates a color through aligned incoming and outgoing ports', () => {
		const incoming = {
			...relation('incoming', 'source', 'middle'),
			points: [
				{ x: 40, y: -100 },
				{ x: 40, y: 0 },
			],
		};
		const outgoing = {
			...relation('outgoing', 'middle', 'target'),
			points: [
				{ x: 40, y: 0 },
				{ x: 40, y: 100 },
			],
		};
		const unrelated = relation('unrelated', 'elsewhere', 'another');
		const colors = relationColors(
			[relation('first', 'one', 'two'), incoming, outgoing, unrelated],
			[['first', 'incoming']],
		);
		expect(colors.get('incoming')).toBe('var(--content-relation-2)');
		expect(colors.get('outgoing')).toBe(colors.get('incoming'));
		expect(colors.get('unrelated')).toBe('var(--content-relation-1)');
	});

	it('does not merge routes touching the same port without a positive common trunk', () => {
		const relations = [
			{
				id: 'a',
				from: 'source',
				to: 'target',
				points: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 },
					{ x: 100, y: 100 },
				],
			},
			{
				id: 'b',
				from: 'source',
				to: 'target',
				points: [
					{ x: 0, y: 0 },
					{ x: 0, y: 100 },
					{ x: 100, y: 100 },
				],
			},
		];
		const colors = relationColors(relations, [['a', 'b']]);
		expect(colors.get('a')).not.toBe(colors.get('b'));
	});

	it('recognizes common trunks through duplicated endpoint coordinates', () => {
		const first = relation('a', 'source', 'first');
		const second = relation('b', 'source', 'second');
		const duplicated = {
			...second,
			points: [{ x: 0, y: 0 }, ...second.points, { x: 100, y: 100 }],
		};
		const colors = relationColors([first, duplicated], [['a', 'b']]);
		expect(colors.get('a')).toBe(colors.get('b'));
	});

	it.each(
		[
			[],
			[{ x: 0, y: 0 }],
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 0 },
			],
			[
				{ x: 0, y: 0 },
				{ x: 100, y: 100 },
			],
		].map((points) => ({ points })),
	)('does not infer shared trunks from non-renderable geometry %j', ({ points }) => {
		const relations = ['a', 'b'].map((id) => ({ id, from: 'source', to: 'target', points }));
		const colors = relationColors(relations, [['a', 'b']]);
		expect(colors.get('a')).not.toBe(colors.get('b'));
	});

	it('ignores contacts within one family and crossing references absent from the layout', () => {
		const relations = [relation('a', 'one', 'first'), relation('b', 'one', 'second')];
		expect(
			new Set(
				relationColors(relations, [
					['a', 'b'],
					['missing', 'a'],
					['a', 'missing'],
				]).values(),
			).size,
		).toBe(1);
	});

	it('accepts an empty graph', () => {
		expect(relationColors([]).size).toBe(0);
	});
});

it('does not classify diagonal or zero-length segments as nearby parallel portions', () => {
	const horizontal = { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } };
	const diagonal = { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } };
	expect(parallelSegmentsAreClose(diagonal, horizontal)).toBe(false);
	expect(parallelSegmentsAreClose(horizontal, diagonal)).toBe(false);
	expect(
		parallelSegmentsAreClose({ start: horizontal.start, end: horizontal.start }, horizontal),
	).toBe(false);
});
