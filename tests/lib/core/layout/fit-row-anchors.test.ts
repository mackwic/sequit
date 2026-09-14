import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { ITEM_GAP } from '../../../../src/lib/core/layout/layout-settings';
import {
	fitRowAnchors,
	type RowAnchorItem,
} from '../../../../src/lib/core/layout/placement/fit-row-anchors';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';

const item = (center: number, options: Partial<RowAnchorItem> = {}): RowAnchorItem => ({
	center,
	size: 40,
	fixed: false,
	...options,
});

describe('ordered row anchors', () => {
	it('preserves empty and unanchored rows exactly', () => {
		expect(fitRowAnchors([])).toEqual([]);
		expect(fitRowAnchors([item(-100.3), item(10.2), item(150.7)])).toEqual([-100.3, 10.2, 150.7]);
	});

	it('reaches compatible anchors while leaving unconstrained positions unchanged', () => {
		expect(
			fitRowAnchors([item(0, { target: -10 }), item(100), item(200, { target: 220 })]),
		).toEqual([-10, 100, 220]);
		expect(fitRowAnchors([item(100, { target: 250 })])).toEqual([250]);
	});

	it('expands the prefix and suffix only when an exact anchor requires space', () => {
		expect(fitRowAnchors([item(0), item(76, { target: -24 }), item(152)])).toEqual([
			-100, -24, 152,
		]);
		expect(fitRowAnchors([item(0, { target: 100 }), item(76), item(152)])).toEqual([100, 176, 252]);
	});

	it('fits an interval from both ends while preserving available slack', () => {
		expect(
			fitRowAnchors([item(0, { target: 30 }), item(100), item(200), item(300, { target: 270 })]),
		).toEqual([30, 106, 194, 270]);
	});

	it('uses both neighboring widths when propagating spacing', () => {
		expect(
			fitRowAnchors([
				item(0, { size: 20, target: 50 }),
				item(96, { size: 100 }),
				item(242, { size: 120 }),
			]),
		).toEqual([50, 146, 292]);
	});

	it('keeps the closer conflicting anchor, whether it appears first or last', () => {
		expect(fitRowAnchors([item(0, { target: 20 }), item(100, { target: 60 })])).toEqual([20, 100]);
		expect(fitRowAnchors([item(0, { target: 80 }), item(100, { target: 110 })])).toEqual([0, 110]);
	});

	it('breaks equal-displacement conflicts in documentary order', () => {
		expect(fitRowAnchors([item(0, { target: 20 }), item(100, { target: 80 })])).toEqual([20, 100]);
	});

	it('can remove several lower-priority anchors without changing row order', () => {
		expect(
			fitRowAnchors([
				item(0, { target: 90 }),
				item(100, { target: 190 }),
				item(200, { target: 210 }),
			]),
		).toEqual([0, 100, 210]);
	});

	it('preserves fixed centers and ignores their proposed targets', () => {
		expect(
			fitRowAnchors([
				item(0, { fixed: true, target: 500 }),
				item(100, { target: 0 }),
				item(200, { target: 150 }),
				item(300, { fixed: true, target: -500 }),
			]),
		).toEqual([0, 100, 200, 300]);
		expect(
			fitRowAnchors([item(0, { target: 190 }), item(100, { fixed: true, target: 1_000 })]),
		).toEqual([0, 100]);
	});

	it('retains an existing alignment when another target would displace it', () => {
		expect(fitRowAnchors([item(0, { target: 0 }), item(100, { target: 20 })])).toEqual([0, 100]);
	});
});

const row = fc
	.array(
		fc.record({
			size: fc.integer({ min: 1, max: 240 }),
			gap: fc.integer({ min: 0, max: 80 }),
			delta: fc.option(fc.integer({ min: -600, max: 600 })),
			fixed: fc.boolean(),
		}),
		{ maxLength: 50 },
	)
	.map((entries): readonly RowAnchorItem[] => {
		let cursor = -100;
		return entries.map(({ size, gap, delta, fixed }) => {
			const center = cursor + size / 2;
			cursor += size + ITEM_GAP + gap;
			let result: RowAnchorItem = { center, size, fixed };
			if (delta !== null) result = { ...result, target: center + delta };
			return Object.freeze(result);
		});
	});

it('preserves spacing, fixed items, determinism and translation on varied immutable rows', () => {
	fc.assert(
		fc.property(row, fc.integer({ min: -1_000, max: 1_000 }), (items, shift) => {
			const snapshot = structuredClone(items);
			const centers = fitRowAnchors(Object.freeze(items));
			expect(centers).toHaveLength(items.length);
			expect(fitRowAnchors(items)).toEqual(centers);
			expect(items).toEqual(snapshot);
			for (const [index, entry] of items.entries()) {
				const center = defined(centers[index]);
				expect(Number.isFinite(center)).toBe(true);
				if (entry.fixed) expect(center).toBe(entry.center);
				if (index === 0) continue;
				const before = defined(items[index - 1]);
				expect(center - defined(centers[index - 1])).toBeGreaterThanOrEqual(
					(before.size + entry.size) / 2 + ITEM_GAP,
				);
			}
			const translated = items.map((entry) => {
				let result = { ...entry, center: entry.center + shift };
				if (entry.target !== undefined) result = { ...result, target: entry.target + shift };
				return result;
			});
			expect(fitRowAnchors(translated)).toEqual(centers.map((center) => center + shift));
		}),
		PROPERTY_PARAMETERS,
	);
});

it('reaches every compatible translated target for varied widths and gaps', () => {
	fc.assert(
		fc.property(row, fc.integer({ min: -500, max: 500 }), (items, shift) => {
			const anchored = items.map((entry) => ({
				...entry,
				fixed: false,
				target: entry.center + shift,
			}));
			expect(fitRowAnchors(anchored)).toEqual(anchored.map((entry) => entry.target));
		}),
		PROPERTY_PARAMETERS,
	);
});
