import { describe, expect, it } from 'vitest';

import {
	AssertBox,
	type BoxGeometry,
} from '../../../src/app/workshop/visual-tests/asserts/assert-box';
import { LayoutDirection } from '../../../src/lib/core/document/logic-document';

const a: BoxGeometry = { id: 'a', bounds: { x: 100, y: 100, width: 100, height: 60 } };
const frame: BoxGeometry = { id: 'frame', bounds: { x: 50, y: 50, width: 200, height: 160 } };

describe('AssertBox centering', () => {
	it.each(['x', 'y', 'both'] as const)('centers on %s with different dimensions', (axis) => {
		const assertions = AssertBox(a);
		expect(assertions.isCenteredIn(frame, { axis })).toBe(assertions);
	});
	it.each(['x', 'y'] as const)('detects a displacement on %s', (axis) => {
		const displaced = { ...a, bounds: { ...a.bounds, [axis]: 110 } };
		expect(() => AssertBox(displaced).isCenteredIn(frame, { axis })).toThrow('difference=10');
		expect(() => AssertBox(displaced).isCenteredIn(frame, { axis: 'both' })).toThrow(
			'difference=10',
		);
	});
	it('only constrains the requested axis', () => {
		AssertBox({ ...a, bounds: { ...a.bounds, y: 200 } }).isCenteredIn(frame, { axis: 'x' });
		AssertBox({ ...a, bounds: { ...a.bounds, x: 200 } }).isCenteredIn(frame, { axis: 'y' });
	});
	it('rejects an unsupported centering axis from an untyped caller', () => {
		const assertions = AssertBox(a);
		expect(() => {
			Reflect.apply(assertions.isCenteredIn.bind(assertions), undefined, [frame, { axis: 'z' }]);
		}).toThrow('Unsupported centering axis: z');
	});
});

// Coordinates are hand-specified, independent from the assertion's directional calculations.
describe.each([
	{
		direction: LayoutDirection.TopToBottom,
		after: { x: 100, y: 180 },
		touching: { x: 100, y: 160 },
	},
	{ direction: LayoutDirection.BottomToTop, after: { x: 100, y: 20 }, touching: { x: 100, y: 40 } },
	{
		direction: LayoutDirection.LeftToRight,
		after: { x: 220, y: 100 },
		touching: { x: 200, y: 100 },
	},
	{ direction: LayoutDirection.RightToLeft, after: { x: -20, y: 100 }, touching: { x: 0, y: 100 } },
])('AssertBox directional order: $direction', ({ direction, after, touching }) => {
	const b = { id: 'b', bounds: { ...a.bounds, ...after } };
	it('requires separated bounds in the direction of progression and keeps its subject', () => {
		const assertions = AssertBox(b);
		expect(assertions.isAfter(a, { direction })).toBe(assertions);
		expect(() => AssertBox(a).isAfter(b, { direction })).toThrow('must be after "b"');
	});
	it('rejects touching and overlapping boxes', () => {
		expect(() =>
			AssertBox({ ...b, bounds: { ...b.bounds, ...touching } }).isAfter(a, { direction }),
		).toThrow('gap=0');
		expect(() => AssertBox(a).isAfter(a, { direction })).toThrow('must be after');
	});
});
