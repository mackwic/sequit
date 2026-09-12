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

	it('distinguishes different quays and unrelated endpoints, and cycles through the palette', () => {
		const colors = relationColors([
			relation('a', 'one', 'first'),
			relation('b', 'one', 'second', 20),
			relation('c', 'two', 'third'),
			relation('d', 'three', 'fourth'),
			relation('e', 'four', 'fifth'),
		]);
		expect([...colors.values()]).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-2)',
			'var(--content-relation-3)',
			'var(--content-relation-4)',
			'var(--content-relation-1)',
		]);
	});

	it('accepts an empty graph', () => {
		expect(relationColors([]).size).toBe(0);
	});
});
