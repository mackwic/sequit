import { describe, expect, it } from 'vitest';

import type { LayoutRelation } from '../../../../../src/app/web/projection/layout-graph';
import { relationColors } from '../../../../../src/app/web/ui/canvas/relation-colors';

function relation(id: string, from: string, to: string, offset = 0): LayoutRelation {
	return {
		id,
		from,
		to,
		points: [
			{ x: offset, y: 0 },
			{ x: 100, y: 100 },
		],
	};
}

describe('relationColors', () => {
	it('keeps shared departure and arrival quays in one color, including merged families', () => {
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
	it('keeps coloring deterministic when the crossing graph exhausts the palette', () => {
		const relations = ['a', 'b', 'c', 'd', 'e'].map((id) => relation(id, id, id));
		const crossings = relations.flatMap((first, index) =>
			relations.slice(index + 1).map((second): readonly [string, string] => [first.id, second.id]),
		);
		const colors = relationColors(relations, crossings);
		expect([...colors.values()]).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-2)',
			'var(--content-relation-3)',
			'var(--content-relation-4)',
			'var(--content-relation-1)',
		]);
		expect(relationColors(relations.toReversed(), crossings.toReversed())).toEqual(colors);
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
