import { describe, expect, it } from 'vitest';

import { layoutComponent } from '../../src/lib/layout/component-layout';

describe('layoutComponent invariants', () => {
	it('produces a finite empty component without rank bands', () => {
		expect(
			layoutComponent([], new Map(), new Map(), 'top-to-bottom', 'top', [], new Set()),
		).toEqual({ boundsById: new Map(), width: 1, height: 0 });
	});

	it('defaults an unranked endpoint to the first rank', () => {
		const layout = layoutComponent(
			['node'],
			new Map(),
			new Map([['node', { width: 80, height: 40 }]]),
			'top-to-bottom',
			'top',
			[40],
			new Set(),
		);

		expect(layout.boundsById.get('node')).toEqual({ x: 0, y: 0, width: 80, height: 40 });
	});

	it('rejects missing measurements and ranks outside the configured bands', () => {
		expect(() =>
			layoutComponent(
				['node'],
				new Map([['node', 0]]),
				new Map(),
				'top-to-bottom',
				'top',
				[40],
				new Set(),
			),
		).toThrow('Missing measured size: node');

		expect(() =>
			layoutComponent(
				['node'],
				new Map([['node', 2]]),
				new Map([['node', { width: 80, height: 40 }]]),
				'top-to-bottom',
				'top',
				[40],
				new Set(),
			),
		).toThrow('Missing layout rank: 2');
	});

	it('places a junction between bands and at the final band', () => {
		const sizes = new Map([
			['junction', { width: 32, height: 32 }],
			['second-junction', { width: 32, height: 32 }],
		]);
		const between = layoutComponent(
			['junction'],
			new Map([['junction', 0]]),
			sizes,
			'top-to-bottom',
			'top',
			[40, 40],
			new Set(['junction']),
		);
		const final = layoutComponent(
			['junction', 'second-junction'],
			new Map([
				['junction', 0],
				['second-junction', 0],
			]),
			sizes,
			'top-to-bottom',
			'top',
			[40],
			new Set(['junction', 'second-junction']),
		);

		expect(between.boundsById.get('junction')?.y).toBeGreaterThan(40);
		expect(final.boundsById.get('junction')?.y).toBe(4);
	});
});
