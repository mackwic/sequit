import { describe, expect, it } from 'vitest';

import type { LayoutRelation } from '../../../../../src/app/web/projection/layout-graph';
import { renderRelationPaths } from '../../../../../src/app/web/ui/canvas/render-relations';
import { AssertRenderedPaths } from '../../../../support/assertions/assert-rendered-paths';

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

	it('puts the bridge on the earlier path when the later crossing is near a bend', () => {
		const rendered = renderRelationPaths([
			relation('vertical', [
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			]),
			relation('bent', [
				{ x: 45, y: 0 },
				{ x: 45, y: 50 },
				{ x: 100, y: 50 },
			]),
		]);
		expect(rendered[0]?.path).toBe('M 50 0 L 50 44 A 6 6 0 0 1 50 56 L 50 100');
		expect(rendered[1]?.path).not.toContain(' A ');
	});

	it('does not mistake a collinear intermediate point for an elbow', () => {
		const rendered = renderRelationPaths([
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
			relation('vertical', [
				{ x: 50, y: 0 },
				{ x: 50, y: 50 },
				{ x: 50, y: 100 },
			]),
		]);
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

	it('moves a crowded bridge to the other arrow instead of losing the crossing', () => {
		const paths = renderRelationPaths([
			relation('left', [
				{ x: 10, y: 0 },
				{ x: 10, y: 100 },
			]),
			relation('right', [
				{ x: 12, y: 0 },
				{ x: 12, y: 100 },
			]),
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
		]);
		AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		expect(paths[0]?.path).toContain('A 6 6 0 0 0 10 56');
		expect(paths[2]?.path).toContain('A 6 6 0 0 1 18 50');
	});

	it('draws the same bridge on every branch of a shared trunk', () => {
		const paths = renderRelationPaths([
			relation('crossing', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
			{
				...relation('first-branch', [
					{ x: 50, y: 0 },
					{ x: 50, y: 100 },
				]),
				from: 'junction',
			},
			{
				...relation('second-branch', [
					{ x: 50, y: 0 },
					{ x: 50, y: 120 },
					{ x: 100, y: 120 },
				]),
				from: 'junction',
			},
		]);
		expect(paths[1]?.path).toBe('M 50 0 L 50 44 A 6 6 0 0 1 50 56 L 50 100');
		expect(paths[2]?.path).toBe('M 50 0 L 50 44 A 6 6 0 0 1 50 56 L 50 120 L 100 120');
		expect(paths[0]?.path).not.toContain(' A ');
	});

	it('moves the bridge when a shared branch has insufficient space before its bend', () => {
		const paths = renderRelationPaths([
			relation('crossing', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
			relation('long', [
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			]),
			relation('short', [
				{ x: 50, y: 0 },
				{ x: 50, y: 53 },
				{ x: 100, y: 53 },
			]),
		]);
		expect(paths[0]?.path).toBe('M 0 50 L 44 50 A 6 6 0 0 1 56 50 L 100 50');
		expect(paths[1]?.path).not.toContain(' A ');
		expect(paths[2]?.path).not.toContain(' A ');
	});

	it('leaves six pixels between an arc and a bend, even when the radius alone fits', () => {
		const paths = renderRelationPaths([
			relation('vertical', [
				{ x: 50, y: 0 },
				{ x: 50, y: 100 },
			]),
			relation('bent', [
				{ x: 40, y: 0 },
				{ x: 40, y: 50 },
				{ x: 100, y: 50 },
			]),
		]);
		expect(paths[0]?.path).toContain('A 6 6 0 0 1 50 56');
		expect(paths[1]?.path).not.toContain(' A ');
	});

	it('leaves six pixels between successive bridges', () => {
		const paths = renderRelationPaths([
			relation('left', [
				{ x: 30, y: 0 },
				{ x: 30, y: 100 },
			]),
			relation('right', [
				{ x: 44, y: 0 },
				{ x: 44, y: 100 },
			]),
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
		]);
		expect(paths[2]?.path).toBe('M 0 50 L 24 50 A 6 6 0 0 1 36 50 L 100 50');
		expect(paths[1]?.path).toContain('A 6 6 0 0 1 44 56');
		AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
	});

	it.each([0, 1, 2, 3])(
		'turns a bridge away from a nearby parallel trunk after %s quarter turns',
		(turns) => {
			function rotate(points: LayoutRelation['points']): LayoutRelation['points'] {
				return points.map((point) => {
					let { x, y } = point;
					for (let turn = 0; turn < turns; turn += 1) [x, y] = [-y, x];
					return { x, y };
				});
			}
			const paths = renderRelationPaths([
				relation(
					'crossing',
					rotate([
						{ x: 0, y: 50 },
						{ x: 100, y: 50 },
					]),
				),
				relation(
					'bridge',
					rotate([
						{ x: 50, y: 0 },
						{ x: 50, y: 100 },
					]),
				),
				relation(
					'nearby',
					rotate([
						{ x: 60, y: 50 },
						{ x: 60, y: 100 },
					]),
				),
			]);
			// The usual bulge leaves only 4px; the opposite side is clear.
			expect(paths[1]?.path).toContain('A 6 6 0 0 0 ');
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		},
	);

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

		expect(rendered.map(({ color }) => color)).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-2)',
		]);
		expect(
			renderRelationPaths([...rendered].reverse().map(({ id, points }) => relation(id, points))),
		).toEqual([
			expect.objectContaining({ id: 'second', color: 'var(--content-relation-2)' }),
			expect.objectContaining({ id: 'first', color: 'var(--content-relation-1)' }),
		]);
	});
});
