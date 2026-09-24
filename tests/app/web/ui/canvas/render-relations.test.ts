import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { LayoutRelation } from '../../../../../src/app/web/projection/layout-graph';
import { renderRelationPaths } from '../../../../../src/app/web/ui/canvas/render-relations';
import { AssertRenderedPaths } from '../../../../support/assertions/assert-rendered-paths';
import { PROPERTY_PARAMETERS } from '../../../../support/builders/property-test-options';

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

		expect(rendered[0]?.color).not.toBe(rendered[1]?.color);
		expect(rendered[0]?.path).toBe('M 0 50 L 100 50');
		expect(rendered[1]?.path).toBe('M 50 0 L 50 44 A 6 6 0 0 1 50 56 L 50 100');
	});

	it('uses the configured palette for a contact cluster', () => {
		const rendered = renderRelationPaths(
			[
				relation('horizontal', [
					{ x: 0, y: 50 },
					{ x: 100, y: 50 },
				]),
				relation('vertical', [
					{ x: 50, y: 0 },
					{ x: 50, y: 100 },
				]),
			],
			['base', 'accent'],
		);
		expect(rendered.map(({ color }) => color)).toEqual(['base', 'accent']);
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

	it('keeps a short crossing straight when neither segment has room for a bridge', () => {
		const paths = renderRelationPaths([
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 15, y: 50 },
			]),
			relation('vertical', [
				{ x: 10, y: 45 },
				{ x: 10, y: 60 },
			]),
		]);
		expect(paths.map(({ path }) => path)).toEqual(['M 0 50 L 15 50', 'M 10 45 L 10 60']);
		expect(paths[0]?.color).not.toBe(paths[1]?.color);
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

	it('draws two bridges on one carrier when their centers are exactly eighteen pixels apart', () => {
		const paths = renderRelationPaths([
			relation('left', [
				{ x: 30, y: 0 },
				{ x: 30, y: 100 },
			]),
			relation('right', [
				{ x: 48, y: 0 },
				{ x: 48, y: 100 },
			]),
			relation('horizontal', [
				{ x: 0, y: 50 },
				{ x: 100, y: 50 },
			]),
		]);
		expect(paths[2]?.path).toBe(
			'M 0 50 L 24 50 A 6 6 0 0 1 36 50 L 42 50 A 6 6 0 0 1 54 50 L 100 50',
		);
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

	it('uses stable, uniform arrow colors for distant routes without crossings', () => {
		const rendered = renderRelationPaths([
			relation('first', [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			]),
			relation('second', [
				{ x: 0, y: 100 },
				{ x: 100, y: 100 },
			]),
		]);

		expect(rendered.map(({ color }) => color)).toEqual([
			'var(--content-relation-1)',
			'var(--content-relation-1)',
		]);
		expect(
			renderRelationPaths([...rendered].reverse().map(({ id, points }) => relation(id, points))),
		).toEqual([
			expect.objectContaining({ id: 'second', color: 'var(--content-relation-1)' }),
			expect.objectContaining({ id: 'first', color: 'var(--content-relation-1)' }),
		]);
	});

	it.each(['horizontal', 'vertical'])(
		'distinguishes three nearby %s routes without crossings',
		(orientation) => {
			const relations = [0, 12, 24].map((offset, index) => {
				let points = [
					{ x: 0, y: offset },
					{ x: 120, y: offset },
				];
				if (orientation === 'vertical') points = points.map(({ x, y }) => ({ x: y, y: x }));
				return relation(`route-${index}`, points);
			});
			const original = structuredClone(relations);
			const rendered = renderRelationPaths(relations);
			expect(new Set(rendered.map(({ color }) => color)).size).toBe(3);
			expect(rendered.every(({ path }) => !path.includes(' A '))).toBe(true);
			const translated = renderRelationPaths(
				relations.toReversed().map((route) => ({
					...route,
					points: route.points.toReversed().map(({ x, y }) => ({ x: x + 99, y: y - 31 })),
				})),
			);
			expect(new Map(translated.map(({ id, color }) => [id, color]))).toEqual(
				new Map(rendered.map(({ id, color }) => [id, color])),
			);
			expect(relations).toEqual(original);
		},
	);

	it.each([
		{ start: 0, end: 100, offset: 25 },
		{ start: 100, end: 200, offset: 24 },
		{ start: 120, end: 200, offset: 0 },
	])('reuses ink for separated parallel portions %j', ({ start, end, offset }) => {
		const rendered = renderRelationPaths([
			relation('first', [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
			]),
			relation('second', [
				{ x: start, y: offset },
				{ x: end, y: offset },
			]),
		]);
		expect(rendered[0]?.color).toBe(rendered[1]?.color);
	});

	it('preserves a real shared trunk while distinguishing a nearby independent route', () => {
		const routes = [
			{
				...relation('a', [
					{ x: 0, y: 0 },
					{ x: 0, y: 120 },
				]),
				from: 'source',
			},
			{
				...relation('b', [
					{ x: 0, y: 0 },
					{ x: 0, y: 40 },
					{ x: 12, y: 40 },
					{ x: 12, y: 120 },
				]),
				from: 'source',
			},
			relation('c', [
				{ x: 24, y: 40 },
				{ x: 24, y: 120 },
			]),
		];
		const colors = new Map(renderRelationPaths(routes).map(({ id, color }) => [id, color]));
		expect(colors.get('a')).toBe(colors.get('b'));
		expect(colors.get('a')).not.toBe(colors.get('c'));
	});

	it('keeps nearby parallel families distinct and deterministic through orientation and ordering changes', () => {
		fc.assert(
			fc.property(
				fc.record({
					count: fc.integer({ min: 2, max: 6 }),
					gap: fc.integer({ min: 1, max: 9 }),
					length: fc.integer({ min: 24, max: 300 }),
					x: fc.integer({ min: -1000, max: 1000 }),
					y: fc.integer({ min: -1000, max: 1000 }),
					vertical: fc.boolean(),
				}),
				({ count, gap, length, x, y, vertical }) => {
					const routes = Array.from({ length: count }, (_, index) => {
						const cross = y + index * gap;
						let points = [
							{ x, y: cross },
							{ x: x + length, y: cross },
						];
						if (vertical) points = points.map(({ x, y }) => ({ x: y, y: x }));
						return relation(`parallel-${index}`, points);
					});
					const first = routes[0];
					if (first === undefined) throw new Error('Expected generated parallel routes');
					const shared = { ...first, id: 'shared-trunk', to: 'another-target' };
					const original = structuredClone(routes);
					const colors = new Map(
						renderRelationPaths([...routes, shared]).map(({ id, color }) => [id, color]),
					);
					expect(new Set(routes.map(({ id }) => colors.get(id))).size).toBe(count);
					expect(colors.get(shared.id)).toBe(colors.get(first.id));
					const reversed = new Map(
						renderRelationPaths([shared, ...routes.toReversed()]).map(({ id, color }) => [
							id,
							color,
						]),
					);
					expect(reversed).toEqual(colors);
					expect(routes).toEqual(original);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
