import fc from 'fast-check';
import { expect, it } from 'vitest';

import { EntityKind } from '../../../../../../src/app/web/ui/canvas/canvas-entity';
import {
	documentPointer,
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
