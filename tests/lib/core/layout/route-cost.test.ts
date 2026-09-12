import { expect, it } from 'vitest';

import { improvesRoutes } from '../../../../src/lib/core/layout/routing/route-cost';

it('accepts fewer bends and ignores collinear subdivisions', () => {
	const bent = new Map([
		[
			'a',
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 10 },
				{ x: 10, y: 10 },
				{ x: 10, y: 20 },
			],
		],
	]);
	const straight = new Map([
		[
			'a',
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 10 },
				{ x: 0, y: 10 },
				{ x: 0, y: 20 },
			],
		],
	]);
	expect(improvesRoutes(bent, straight)).toBe(true);
	expect(improvesRoutes(straight, straight)).toBe(false);
	expect(improvesRoutes(straight, bent)).toBe(false);
});

it('rejects fewer bends when they introduce a crossing', () => {
	const horizontal = [
		{ x: 0, y: 10 },
		{ x: 20, y: 10 },
	];
	const before = new Map([
		['a', horizontal],
		[
			'b',
			[
				{ x: 30, y: 0 },
				{ x: 30, y: 20 },
				{ x: 10, y: 20 },
			],
		],
	]);
	const after = new Map([
		['a', horizontal],
		[
			'b',
			[
				{ x: 10, y: 0 },
				{ x: 10, y: 20 },
			],
		],
	]);
	expect(improvesRoutes(before, after)).toBe(false);
});
