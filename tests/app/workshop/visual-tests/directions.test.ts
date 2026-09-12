import { describe, expect, it } from 'vitest';

import {
	defaultVisualTestSettings,
	parseVisualTestSettings,
} from '../../../../src/app/workshop/visual-tests/directions';
import { LayoutBias, LayoutDirection } from '../../../../src/lib/core/document/logic-document';

describe('stored visual test settings', () => {
	it('restores a valid layout configuration and guide preference', () => {
		expect(
			parseVisualTestSettings(
				JSON.stringify({
					direction: LayoutDirection.LeftToRight,
					bias: LayoutBias.Right,
					guides: false,
				}),
			),
		).toEqual({
			direction: LayoutDirection.LeftToRight,
			bias: LayoutBias.Right,
			guides: false,
		});
	});

	it.each([
		null,
		'{invalid',
		'null',
		JSON.stringify({ direction: 'unknown', bias: LayoutBias.Top, guides: true }),
		JSON.stringify({ direction: LayoutDirection.TopToBottom, bias: 'unknown', guides: true }),
		JSON.stringify({ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Left, guides: true }),
		JSON.stringify({ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top }),
	])('uses defaults when the stored value is unusable', (stored) => {
		expect(parseVisualTestSettings(stored)).toEqual(defaultVisualTestSettings);
	});
});
