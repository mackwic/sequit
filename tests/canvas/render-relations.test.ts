import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../src/lib/canvas/render-relations';
import type { LayoutRelation } from '../../src/lib/layout/layout-graph';

function relation(id: string, points: LayoutRelation['points']): LayoutRelation {
	return { id, from: `${id}-source`, to: `${id}-target`, points };
}

describe('renderRelationPaths', () => {
	it('draws a bridge where a later arrow crosses an earlier arrow', () => {
		const rendered = renderRelationPaths([
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
			relation('vertical', [
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			]),
		]);

		expect(rendered[0]?.path).toBe('M 0 50 L 100 50');
		expect(rendered[1]?.path).toBe('M 50 0 L 50 44 A 6 6 0 0 1 50 56 L 50 100');
	});

	it('handles invalid, discontinuous, reversed, and overlapping crossing segments', () => {
		const rendered = renderRelationPaths([
			relation('duplicate-vertical', [
				{ x: 10, y: 0 },
				{ x: 10, y: 100 },
				{ x: 10, y: 0 },
			]),
			relation('near-start', [
				{ x: 3, y: 0 },
				{ x: 3, y: 100 },
			]),
			relation('overlap', [
				{ x: 12, y: 0 },
				{ x: 12, y: 100 },
			]),
			relation('discontinuous-horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
				{ x: 110, y: 60 },
				{ x: 200, y: 60 },
			]),
			relation('reversed-horizontal', [
				{ x: 100, y: 75 },
				{ x: 0, y: 75 },
			]),
			relation('diagonal', [
				{ x: 0, y: 0 },
				{ x: 5, y: 5 },
			]),
		]);

		expect(rendered.find(({ id }) => id === 'diagonal')?.path).toBe('');
		expect(rendered.find(({ id }) => id === 'discontinuous-horizontal')?.path).toContain(
			'L 110 60',
		);
		expect(rendered.find(({ id }) => id === 'reversed-horizontal')?.path).toContain(
			'A 6 6 0 0 1 6 75',
		);
	});

	it('uses stable, subtly different arrow colors', () => {
		const rendered = renderRelationPaths([
			relation('first', [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			]),
			relation('second', [
				{ x: 0, y: 20 },
				{ x: 100, y: 20 },
			]),
		]);

		expect(rendered.map(({ color }) => color)).toEqual(['#78716c', '#817a75']);
		expect(
			renderRelationPaths([...rendered].reverse().map(({ id, points }) => relation(id, points))),
		).toEqual([
			expect.objectContaining({ id: 'second', color: '#78716c' }),
			expect.objectContaining({ id: 'first', color: '#817a75' }),
		]);
	});
});
