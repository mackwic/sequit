import { describe, expect, it } from 'vitest';

import { EntityKind } from '../../../../../src/app/web/ui/canvas/canvas-entity';
import { selectionInsideEnvelope } from '../../../../../src/app/web/ui/canvas/selection-envelope';

const candidates = [
	{
		ref: { kind: EntityKind.Node, id: 'inside' },
		bounds: { left: 10, top: 10, right: 30, bottom: 30 },
	},
	{
		ref: { kind: EntityKind.Junction, id: 'crossed' },
		bounds: { left: 28, top: 28, right: 50, bottom: 50 },
	},
	{
		ref: { kind: EntityKind.Node, id: 'outside' },
		bounds: { left: 60, top: 60, right: 80, bottom: 80 },
	},
	{
		ref: { kind: EntityKind.Group, id: 'containing-group' },
		bounds: { left: 0, top: 0, right: 100, bottom: 100 },
	},
];

describe('selection envelope', () => {
	it('tracks intersected nodes, but never junctions or groups', () => {
		expect(
			selectionInsideEnvelope([], candidates, {
				from: { x: 35, y: 35 },
				to: { x: 5, y: 5 },
				additive: false,
			}),
		).toEqual([{ kind: EntityKind.Node, id: 'inside' }]);
	});

	it('preserves the initial selection only in additive mode without duplicates', () => {
		const initial = [
			{ kind: EntityKind.Group, id: 'group' },
			{ kind: EntityKind.Node, id: 'inside' },
		] as const;
		const from = { x: 25, y: 25 };
		const to = { x: 55, y: 55 };

		expect(selectionInsideEnvelope(initial, candidates, { from, to, additive: true })).toEqual(
			initial,
		);
		expect(selectionInsideEnvelope(initial, candidates, { from, to, additive: false })).toEqual([
			{ kind: EntityKind.Node, id: 'inside' },
		]);
	});
});
