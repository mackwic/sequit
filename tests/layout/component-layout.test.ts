import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
} from '../../src/lib/document/logic-document';
import { layoutComponent } from '../../src/lib/layout/component-layout';
import type { Bounds, Size } from '../../src/lib/layout/layout-types';
import { PROPERTY_PARAMETERS } from '../builders/property-test-options';

const sizeArbitrary: fc.Arbitrary<Size> = fc.record({
	width: fc.integer({ min: 1, max: 10_000 }),
	height: fc.integer({ min: 1, max: 10_000 }),
});
const layoutConfigurationArbitrary: fc.Arbitrary<LayoutConfiguration> = fc.constantFrom(
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
);

function crossStart(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.x;
	return bounds.y;
}

function crossLength(bounds: Bounds, vertical: boolean): number {
	if (vertical) return bounds.width;
	return bounds.height;
}

function requiredAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error(`Missing generated value: ${index}`);
	return value;
}

function isVertical(direction: LayoutConfiguration['direction']): boolean {
	return direction === LayoutDirection.TopToBottom || direction === LayoutDirection.BottomToTop;
}

function primarySize(size: Size, vertical: boolean): number {
	if (vertical) return size.height;
	return size.width;
}

function primaryLayoutLength(
	layout: { readonly width: number; readonly height: number },
	vertical: boolean,
): number {
	if (vertical) return layout.height;
	return layout.width;
}

function generatedRank(id: string): number {
	if (id === 'target') return 1;
	return 0;
}

function expectBetween(
	source: Bounds,
	middle: Bounds,
	target: Bounds,
	direction: LayoutConfiguration['direction'],
): void {
	switch (direction) {
		case LayoutDirection.TopToBottom:
			expect(source.y + source.height).toBeLessThan(middle.y);
			expect(middle.y + middle.height).toBeLessThan(target.y);
			break;
		case LayoutDirection.BottomToTop:
			expect(target.y + target.height).toBeLessThan(middle.y);
			expect(middle.y + middle.height).toBeLessThan(source.y);
			break;
		case LayoutDirection.LeftToRight:
			expect(source.x + source.width).toBeLessThan(middle.x);
			expect(middle.x + middle.width).toBeLessThan(target.x);
			break;
		case LayoutDirection.RightToLeft:
			expect(target.x + target.width).toBeLessThan(middle.x);
			expect(middle.x + middle.width).toBeLessThan(source.x);
			break;
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

function primaryGap(
	source: Bounds,
	target: Bounds,
	direction: LayoutConfiguration['direction'],
): number {
	switch (direction) {
		case LayoutDirection.TopToBottom:
			return target.y - source.y - source.height;
		case LayoutDirection.BottomToTop:
			return source.y - target.y - target.height;
		case LayoutDirection.LeftToRight:
			return target.x - source.x - source.width;
		case LayoutDirection.RightToLeft:
			return source.x - target.x - target.width;
		default:
			throw new Error(`Unsupported layout direction: ${String(direction)}`);
	}
}

describe('layoutComponent invariants', () => {
	it('produces a finite empty component without rank bands', () => {
		expect(
			layoutComponent(
				[],
				new Map(),
				new Map(),
				LayoutDirection.TopToBottom,
				LayoutBias.Top,
				[],
				new Set(),
			),
		).toEqual({ boundsById: new Map(), width: 1, height: 0 });
	});

	it('defaults an unranked endpoint to the first rank', () => {
		const layout = layoutComponent(
			['node'],
			new Map(),
			new Map([['node', { width: 80, height: 40 }]]),
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
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
				LayoutDirection.TopToBottom,
				LayoutBias.Top,
				[40],
				new Set(),
			),
		).toThrow('Missing measured size: node');

		expect(() =>
			layoutComponent(
				['node'],
				new Map([['node', 2]]),
				new Map([['node', { width: 80, height: 40 }]]),
				LayoutDirection.TopToBottom,
				LayoutBias.Top,
				[40],
				new Set(),
			),
		).toThrow('Missing layout rank: 2');
	});

	it('places a junction between bands and at the final band', () => {
		const sizes = new Map([
			['junction', { width: 32, height: 32 }],
			['second-junction', { width: 32, height: 64 }],
		]);
		const between = layoutComponent(
			['junction'],
			new Map([['junction', 0]]),
			sizes,
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
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
			LayoutDirection.TopToBottom,
			LayoutBias.Top,
			[40],
			new Set(['junction', 'second-junction']),
		);

		expect(between.boundsById.get('junction')?.y).toBeGreaterThan(40);
		expect(final.boundsById.get('junction')?.y).toBe(16);
		expect(final.boundsById.get('second-junction')?.y).toBe(0);
		expect(final.height).toBe(64);
	});
	it('keeps arbitrarily many same-rank nodes in ordered lanes with an exact item gap', () => {
		fc.assert(
			fc.property(fc.array(sizeArbitrary, { minLength: 2, maxLength: 12 }), (generatedSizes) => {
				const ids = generatedSizes.map((_, index) => `node-${index}`);
				const sizes = new Map(ids.map((id, index) => [id, requiredAt(generatedSizes, index)]));
				const ranks = new Map(ids.map((id) => [id, 0]));
				const bandHeight = Math.max(...generatedSizes.map(({ height }) => height));
				const layout = layoutComponent(
					ids,
					ranks,
					sizes,
					LayoutDirection.TopToBottom,
					LayoutBias.Top,
					[bandHeight],
					new Set(),
				);

				for (let index = 1; index < ids.length; index += 1) {
					const previous = layout.boundsById.get(requiredAt(ids, index - 1));
					const current = layout.boundsById.get(requiredAt(ids, index));
					expect(previous).toBeDefined();
					expect(current).toBeDefined();
					if (!previous || !current) throw new Error('Missing generated same-rank bounds');
					expect(current.x - previous.x - previous.width).toBe(36);
				}
			}),
			PROPERTY_PARAMETERS,
		);
	});

	it('separates mixed regular and junction endpoints for every direction and bias', () => {
		fc.assert(
			fc.property(
				layoutConfigurationArbitrary,
				fc.array(sizeArbitrary, { minLength: 5, maxLength: 5 }),
				(configuration, generatedSizes) => {
					const ids = ['source-a', 'junction-a', 'source-b', 'junction-b', 'target'];
					const sizes = new Map(ids.map((id, index) => [id, requiredAt(generatedSizes, index)]));
					const ranks = new Map(ids.map((id) => [id, generatedRank(id)]));
					const vertical = isVertical(configuration.direction);
					const firstBand = Math.max(
						primarySize(requiredAt(generatedSizes, 0), vertical),
						primarySize(requiredAt(generatedSizes, 2), vertical),
					);
					const layout = layoutComponent(
						ids,
						ranks,
						sizes,
						configuration.direction,
						configuration.bias,
						[firstBand, primarySize(requiredAt(generatedSizes, 4), vertical)],
						new Set(['junction-a', 'junction-b']),
					);

					for (let index = 1; index < ids.length; index += 1) {
						const previous = layout.boundsById.get(requiredAt(ids, index - 1));
						const current = layout.boundsById.get(requiredAt(ids, index));
						expect(previous).toBeDefined();
						expect(current).toBeDefined();
						if (!previous || !current) throw new Error('Missing generated mixed-rank bounds');
						expect(
							crossStart(current, vertical) -
								crossStart(previous, vertical) -
								crossLength(previous, vertical),
						).toBe(36);
					}
					const source = layout.boundsById.get('source-a');
					const junction = layout.boundsById.get('junction-a');
					const target = layout.boundsById.get('target');
					if (!source || !junction || !target) throw new Error('Missing generated relation bounds');
					expectBetween(source, junction, target, configuration.direction);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('keeps the exact rank gap under extreme sizes and opposite directions', () => {
		fc.assert(
			fc.property(
				layoutConfigurationArbitrary,
				sizeArbitrary,
				sizeArbitrary,
				(configuration, sourceSize, targetSize) => {
					const vertical = isVertical(configuration.direction);
					const layout = layoutComponent(
						['source', 'target'],
						new Map([
							['source', 0],
							['target', 1],
						]),
						new Map([
							['source', sourceSize],
							['target', targetSize],
						]),
						configuration.direction,
						configuration.bias,
						[primarySize(sourceSize, vertical), primarySize(targetSize, vertical)],
						new Set(),
					);
					const source = layout.boundsById.get('source');
					const target = layout.boundsById.get('target');
					if (!source || !target) throw new Error('Missing generated rank bounds');
					expect(primaryGap(source, target, configuration.direction)).toBe(72);
					const expectedPrimaryLength =
						primarySize(sourceSize, vertical) + 72 + primarySize(targetSize, vertical);
					expect(primaryLayoutLength(layout, vertical)).toBe(expectedPrimaryLength);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});
});
