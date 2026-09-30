import fc from 'fast-check';
import { expect, it } from 'vitest';

import { EntityKind } from '../../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	documentPointer,
	edgeIndicator,
	isOutsideViewport,
	sharedSelection,
	viewportPointer,
} from '../../../../../../src/app/web/ui/components/collaboration/canvas-awareness';
import { SharedElementKind } from '../../../../../../src/lib/infrastructure/document/shared-document-command';

it('keeps pointer positions in document space independent of viewport translation and zoom', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: -10000, max: 10000 }),
			fc.integer({ min: -10000, max: 10000 }),
			fc.integer({ min: 1, max: 400 }),
			(x, y, percent) => {
				const frame = { x: -140, y: 340, zoom: percent / 100 };
				const projected = viewportPointer(documentPointer({ x, y }, frame), frame);
				expect(projected.x).toBeCloseTo(x, 8);
				expect(projected.y).toBeCloseTo(y, 8);
			},
		),
	);
});
it('distinguishes selected kinds even when their ids coincide', () => {
	expect(
		sharedSelection([
			{ kind: EntityKind.Node, id: 'A' },
			{ kind: EntityKind.Relation, id: 'A' },
			{ kind: EntityKind.Group, id: 'G' },
			{ kind: EntityKind.Junction, id: 'J' },
		]),
	).toEqual([
		{ kind: SharedElementKind.Node, id: 'A' },
		{ kind: SharedElementKind.Relation, id: 'A' },
		{ kind: SharedElementKind.Group, id: 'G' },
		{ kind: SharedElementKind.Junction, id: 'J' },
	]);
});
it('treats the viewport edges as inside and anything beyond as outside', () => {
	const size = { width: 800, height: 600 };
	expect(isOutsideViewport({ x: 0, y: 0 }, size)).toBe(false);
	expect(isOutsideViewport({ x: 800, y: 600 }, size)).toBe(false);
	expect(isOutsideViewport({ x: -1, y: 300 }, size)).toBe(true);
	expect(isOutsideViewport({ x: 400, y: 601 }, size)).toBe(true);
});
it('pins an off-screen pointer inside the nearest edge and aims the chip at it', () => {
	const size = { width: 800, height: 600 };
	expect(edgeIndicator({ x: 1200, y: 300 }, size, 20)).toEqual({ x: 780, y: 300, angle: 0 });
	expect(edgeIndicator({ x: 400, y: -50 }, size, 20)).toEqual({ x: 400, y: 20, angle: -90 });
	const corner = edgeIndicator({ x: -100, y: 700 }, size, 20);
	expect(corner).toMatchObject({ x: 20, y: 580 });
	expect(corner.angle).toBeCloseTo(135, 5);
});
it('keeps the chip inside a viewport narrower than twice the margin', () => {
	fc.assert(
		fc.property(
			fc.integer({ min: -5000, max: 5000 }),
			fc.integer({ min: -5000, max: 5000 }),
			fc.integer({ min: 0, max: 60 }),
			fc.integer({ min: 0, max: 60 }),
			(x, y, width, height) => {
				const chip = edgeIndicator({ x, y }, { width, height }, 40);
				expect(chip.x).toBeGreaterThanOrEqual(Math.min(40, width));
				expect(chip.x).toBeLessThanOrEqual(Math.max(40, width));
				expect(chip.y).toBeGreaterThanOrEqual(Math.min(40, height));
				expect(chip.y).toBeLessThanOrEqual(Math.max(40, height));
			},
		),
	);
});
