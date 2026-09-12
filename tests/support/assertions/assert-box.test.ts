import { describe, expect, it } from 'vitest';

import { LARGE_BOX_WIDTH } from '../fixtures/layout-reference';
import { AssertBox, type BoxGeometry } from './assert-box';

const a: BoxGeometry = { id: 'a', bounds: { x: 20, y: 40, width: 100, height: 60 } };
const b: BoxGeometry = { id: 'b', bounds: { x: -30, y: 40, width: 200, height: 120 } };
const below: BoxGeometry = { id: 'below', bounds: { x: 50, y: 200, width: 40, height: 80 } };

describe('AssertBox alignment', () => {
	it('aligns top edges despite different heights and positions on X', () => {
		AssertBox(a).isAlignedWith(b, { by: 'top' });
	});
	it('aligns centers despite different widths and positions on Y', () => {
		AssertBox(a).isAlignedWith(below, { by: 'centerX' });
	});
	it('chains assertions on the original box', () => {
		const assertions = AssertBox(a);
		expect(assertions.isAlignedWith(b, { by: 'top' }).isAlignedWith(below, { by: 'centerX' })).toBe(
			assertions,
		);
		// If the subject switched to `below`, this final top comparison would incorrectly pass.
		expect(() => assertions.isAlignedWith(below, { by: 'top' })).toThrow('actual=40, expected=200');
	});
	it('reports IDs, reference coordinates, difference and tolerance on failure', () => {
		const shifted = { ...below, bounds: { ...below.bounds, x: 60 } };
		expect(() => AssertBox(a).isAlignedWith(shifted, { by: 'centerX' })).toThrow(
			'Box "a" is not aligned with box "below" by centerX: actual=70, expected=80, difference=10, tolerance=0.001 (layout units).',
		);
	});
	it('does not mistake identical left edges for aligned centers', () => {
		const wider = { ...b, bounds: { ...b.bounds, x: a.bounds.x } };
		expect(() => AssertBox(a).isAlignedWith(wider, { by: 'centerX' })).toThrow('difference=50');
	});
	it('accepts the tolerance boundary and rejects a larger difference', () => {
		const shifted = { ...b, bounds: { ...b.bounds, y: 40.125 } };
		AssertBox(a).isAlignedWith(shifted, { by: 'top', tolerance: 0.125 });
		expect(() => AssertBox(a).isAlignedWith(shifted, { by: 'top', tolerance: 0.0625 })).toThrow(
			'difference=0.125',
		);
	});
	it('supports exact comparison and the default numerical tolerance', () => {
		const shifted = { ...b, bounds: { ...b.bounds, y: 40.0005 } };
		AssertBox(a).isAlignedWith(b, { by: 'top', tolerance: 0 });
		AssertBox(a).isAlignedWith(shifted, { by: 'top' });
		expect(() => AssertBox(a).isAlignedWith(shifted, { by: 'top', tolerance: 0 })).toThrow();
	});
	it('aligns a large box with a small box and still detects a small displacement', () => {
		const wide = {
			...a,
			bounds: { ...a.bounds, width: LARGE_BOX_WIDTH },
		};
		// Both centers are at x = 5_020; the expected position is specified independently.
		const centered = { ...below, bounds: { ...below.bounds, x: 5_000 } };
		const shifted = { ...below, bounds: { ...below.bounds, x: 5_010 } };
		AssertBox(wide).isAlignedWith(centered, { by: 'centerX' });
		expect(() => AssertBox(wide).isAlignedWith(shifted, { by: 'centerX' })).toThrow(
			'difference=10',
		);
	});
	it('rejects an unsupported alignment from an untyped caller', () => {
		const assertions = AssertBox(a);
		expect(() => {
			Reflect.apply(assertions.isAlignedWith.bind(assertions), undefined, [b, { by: 'left' }]);
		}).toThrow('Unsupported box alignment: left');
	});
	it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid tolerance %s',
		(tolerance) => {
			expect(() => AssertBox(a).isAlignedWith(b, { by: 'top', tolerance })).toThrow(
				'tolerance must be finite and non-negative',
			);
		},
	);
	it.each([{ x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { width: 0 }, { height: -1 }])(
		'rejects invalid geometry %j on either subject',
		(bounds) => {
			const invalid = { ...a, bounds: { ...a.bounds, ...bounds } };
			expect(() => AssertBox(invalid).isAlignedWith(b, { by: 'top' })).toThrow(
				'finite coordinates and positive dimensions',
			);
			expect(() => AssertBox(b).isAlignedWith(invalid, { by: 'centerX' })).toThrow(
				'finite coordinates and positive dimensions',
			);
		},
	);
});
