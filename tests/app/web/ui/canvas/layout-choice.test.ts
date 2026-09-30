import { describe, expect, it } from 'vitest';

import {
	LAYOUT_SIDES,
	layoutChoice,
	LayoutSide,
	layoutSide,
} from '../../../../../src/app/web/ui/canvas/layout-choice';
import {
	LAYOUT_DIRECTIONS,
	LayoutBias,
	LayoutDirection,
} from '../../../../../src/lib/core/document/logic-document';

describe('layoutSide', () => {
	it('reads the bias at the origin of the direction as the root side', () => {
		expect(layoutSide({ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top })).toBe(
			LayoutSide.Root,
		);
		expect(layoutSide({ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right })).toBe(
			LayoutSide.Root,
		);
		expect(layoutSide({ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top })).toBe(
			LayoutSide.Leaves,
		);
		expect(layoutSide({ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Right })).toBe(
			LayoutSide.Leaves,
		);
	});
});

describe('layoutChoice', () => {
	it('keeps the side an author chose across every direction', () => {
		for (const direction of LAYOUT_DIRECTIONS)
			for (const side of LAYOUT_SIDES) expect(layoutSide(layoutChoice(direction, side))).toBe(side);
	});

	it('changing the axis remaps the bias so the leaves stay aligned', () => {
		const leaves = layoutSide({ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Bottom });
		expect(layoutChoice(LayoutDirection.LeftToRight, leaves)).toEqual({
			direction: LayoutDirection.LeftToRight,
			bias: LayoutBias.Right,
		});
	});
});
