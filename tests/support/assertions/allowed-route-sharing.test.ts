import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../src/lib/core/document/logic-document';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';
import { AssertRoutes } from './assert-routes';

function route(
	id: string,
	from: string,
	to: string,
	points: readonly (readonly [number, number])[],
): LayoutRelation {
	return { id, from, to, points: points.map(([x, y]) => ({ x, y })) };
}

const fork = [
	route('a-b', 'a', 'b', [
		[0, 0],
		[0, 10],
		[10, 10],
		[10, 20],
	]),
	route('a-c', 'a', 'c', [
		[0, 0],
		[0, 10],
		[20, 10],
		[20, 20],
	]),
];
const convergence = fork.map((path) => ({
	...path,
	from: path.to,
	to: path.from,
	points: path.points.toReversed(),
}));

describe('permitted shared trunks', () => {
	it('preserves sharing rules under translation, scaling and axis exchange', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: -1000, max: 1000 }),
				fc.integer({ min: -1000, max: 1000 }),
				fc.integer({ min: 1, max: 20 }),
				fc.boolean(),
				(dx, dy, scale, transpose) => {
					const transform = (paths: readonly LayoutRelation[]) =>
						paths.map((path) => ({
							...path,
							points: path.points.map(({ x, y }) => {
								if (transpose) return { x: y * scale + dx, y: x * scale + dy };
								return { x: x * scale + dx, y: y * scale + dy };
							}),
						}));
					AssertRoutes(transform(fork)).haveOnlyAllowedSharedTrunks();
					const invalid = [
						...convergence,
						route('cross', 'e', 'f', [
							[5, 15],
							[15, 15],
						]),
					];
					expect(() => AssertRoutes(transform(invalid)).haveOnlyAllowedSharedTrunks()).toThrow(
						'Port entrant',
					);
				},
			),
		);
	});
	it('allows continuous source trunks on both axes, including partial transverse overlap', () => {
		const check = AssertRoutes(fork);
		expect(check.haveOnlyAllowedSharedTrunks()).toBe(check);
		expect(() => check.haveNoOverlap()).toThrow('overlap');
	});
	it('allows a shared incoming trunk when neither arrow crosses another', () => {
		AssertRoutes(convergence).haveOnlyAllowedSharedTrunks();
	});
	it('keeps a crossed source trunk shareable', () => {
		AssertRoutes([
			...fork,
			route('cross', 'e', 'f', [
				[-10, 5],
				[15, 5],
			]),
		]).haveOnlyAllowedSharedTrunks();
	});
	it('forbids arrival sharing if only one of the converging arrows has crossed', () => {
		const paths = [
			...convergence,
			route('cross', 'e', 'f', [
				[5, 15],
				[15, 15],
			]),
		];
		expect(() => AssertRoutes(paths).haveOnlyAllowedSharedTrunks()).toThrow('Port entrant');
	});
	it('allows crossed junction arrivals while keeping unrelated overlap forbidden', () => {
		const paths = [
			...convergence,
			route('cross', 'e', 'f', [
				[5, 15],
				[15, 15],
			]),
		];
		AssertRoutes(paths).haveOnlyAllowedSharedTrunks(paths, new Set(['a']));
		const unrelated = paths.map((path) => ({ ...path, to: path.id }));
		expect(() =>
			AssertRoutes(unrelated).haveOnlyAllowedSharedTrunks(
				unrelated,
				new Set(unrelated.map(({ to }) => to)),
			),
		).toThrow('Tronc commun interdit');
	});
	it('marks every arrow using a crossed shared trunk', () => {
		const context = [
			...fork,
			route('cross', 'e', 'f', [
				[-10, 5],
				[15, 5],
			]),
		];
		for (const path of fork) {
			const other = route('arrival', 'z', path.to, [
				[30, 30],
				[defined(path.points.at(-1)).x, 30],
				[defined(path.points.at(-1)).x, 20],
			]);
			expect(() =>
				AssertRoutes([path, other]).haveOnlyAllowedSharedTrunks([...context, other]),
			).toThrow('Port entrant');
		}
	});
	it.each([false, true])(
		'both crossing participants need exclusive arrival ports (reverse order: %s)',
		(reverse) => {
			const horizontal = route('horizontal', 'a', 'c', [
				[0, 0],
				[0, 10],
				[20, 10],
				[20, 20],
			]);
			const vertical = route('vertical', 'b', 'd', [
				[10, 0],
				[10, 20],
			]);
			let crossing = [horizontal, vertical];
			if (reverse) crossing = crossing.toReversed();
			for (const path of crossing) {
				// Only the final point is shared: no positive overlap can hide the violation.
				const other = route('other', 'e', path.to, [
					[30, 20],
					[defined(path.points.at(-1)).x, 20],
				]);
				expect(() => AssertRoutes([...crossing, other]).haveOnlyAllowedSharedTrunks()).toThrow(
					'Port entrant',
				);
			}
		},
	);
	it('rejects overlap without a common endpoint', () => {
		expect(() =>
			AssertRoutes(
				fork.map((path, index) => ({ ...path, from: `s${index}` })),
			).haveOnlyAllowedSharedTrunks(),
		).toThrow('Tronc commun interdit');
	});
	it('rejects a reunion after branches have separated from the same source', () => {
		const routes = [
			route('a-b', 'a', 'b', [
				[0, 0],
				[0, 10],
				[10, 10],
				[10, 30],
			]),
			route('a-c', 'a', 'c', [
				[0, 0],
				[0, 5],
				[20, 5],
				[20, 20],
				[10, 20],
				[10, 30],
			]),
		];
		expect(() => AssertRoutes(routes).haveOnlyAllowedSharedTrunks()).toThrow(
			'Tronc commun interdit',
		);
	});
	it('does not legitimize a shared middle segment with distinct arrival anchors', () => {
		const routes = [
			route('b-a', 'b', 'a', [
				[10, 20],
				[10, 10],
				[0, 10],
				[0, 5],
				[-5, 5],
				[-5, 0],
			]),
			route('c-a', 'c', 'a', [
				[20, 20],
				[20, 10],
				[0, 10],
				[0, 5],
				[5, 5],
				[5, 0],
			]),
		];
		expect(() => AssertRoutes(routes).haveOnlyAllowedSharedTrunks()).toThrow(
			'Tronc commun interdit',
		);
	});
});
