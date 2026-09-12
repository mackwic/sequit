import { describe, expect, it } from 'vitest';

import { renderRelationPaths } from '../../../src/app/web/ui/canvas/render-relations';
import { AssertRenderedPaths } from '../../../src/app/workshop/visual-tests/assert-rendered-paths';
import type { LayoutRelation } from '../../../src/lib/core/layout/layout-types';

const routes: readonly LayoutRelation[] = [
	{
		id: 'h',
		from: 'a',
		to: 'b',
		points: [
			{ x: 0, y: 50 },
			{ x: 100, y: 50 },
		],
	},
	{
		id: 'v1',
		from: 'c',
		to: 'd',
		points: [
			{ x: 25, y: 0 },
			{ x: 25, y: 100 },
		],
	},
	{
		id: 'v2',
		from: 'e',
		to: 'f',
		points: [
			{ x: 75, y: 0 },
			{ x: 75, y: 100 },
		],
	},
];

describe('bridges on rendered paths', () => {
	it('checks every crossing and accepts either carrier and reversed routes', () => {
		for (const input of [
			routes,
			[...routes].reverse(),
			routes.map((route) => ({ ...route, points: [...route.points].reverse() })),
		]) {
			AssertRenderedPaths(renderRelationPaths(input)).haveBridgeAtEveryCrossing();
		}
	});
	it('rejects a missing bridge even when another crossing has its bridge', () => {
		const paths = renderRelationPaths(routes).map((path) => {
			if (path.id !== 'v2') return path;
			return { ...path, path: 'M 75 0 L 75 100' };
		});
		expect(() => {
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		}).toThrow('Missing bridge at (75, 50)');
	});
	it('rejects a bridge placed away from its crossing', () => {
		const paths = renderRelationPaths(routes).map((path) => {
			if (path.id !== 'v2') return path;
			return { ...path, path: 'M 75 0 L 75 64 A 6 6 0 0 1 75 76 L 75 100' };
		});
		expect(() => {
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		}).toThrow('(75, 50)');
	});
	it('does not accept an arc carried by an unrelated route', () => {
		const paths = renderRelationPaths(routes).map((path) => {
			if (path.id !== 'v2') return path;
			return { ...path, path: 'M 75 0 L 75 100' };
		});
		paths.push({
			id: 'unrelated',
			from: 'g',
			to: 'i',
			points: [
				{ x: 200, y: 0 },
				{ x: 200, y: 100 },
			],
			color: 'black',
			path: 'M 75 0 L 75 44 A 6 6 0 0 1 75 56 L 75 100',
		});
		expect(() => {
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		}).toThrow('(75, 50)');
	});
	it('does not require a bridge at an intentional T-shaped join', () => {
		const join = routes
			.map((route) => ({ ...route, points: route.points.map((point) => ({ ...point })) }))
			.slice(0, 2);
		join[1] = {
			id: 'join',
			from: 'c',
			to: 'b',
			points: [
				{ x: 25, y: 0 },
				{ x: 25, y: 50 },
			],
		};
		AssertRenderedPaths(renderRelationPaths(join)).haveBridgeAtEveryCrossing();
	});
	it.each([
		'M 75 0 L 75 44 A 6 8 0 0 1 75 56 L 75 100',
		'M 75 0 L 75 44 A 6 6 0 1 1 75 56 L 75 100',
		'M 75 0 L 75 44 A 6 6 0 0 1 81 50 L 75 100',
	])('does not confuse another arc with a bridge: %s', (path) => {
		const paths = renderRelationPaths(routes).map((item) => {
			if (item.id === 'v2') return { ...item, path };
			return item;
		});
		expect(() => {
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		}).toThrow('Missing bridge');
	});
	it.each(['', 'M NaN 0', 'Q 0 0 1 1', 'A 6 6 0 0 1 0 0'])(
		'refuses an invalid or unsupported rendered path: %s',
		(path) => {
			const paths = renderRelationPaths(routes).map((item) => ({ ...item, path }));
			expect(() => {
				AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
			}).toThrow();
		},
	);
	it('rejects empty input and duplicate identifiers', () => {
		expect(() => {
			AssertRenderedPaths([]).haveBridgeAtEveryCrossing();
		}).toThrow('at least two');
		const paths = renderRelationPaths(routes).map((item) => ({ ...item, id: 'duplicate' }));
		expect(() => {
			AssertRenderedPaths(paths).haveBridgeAtEveryCrossing();
		}).toThrow('unique');
	});
});
