import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { routePoints } from '../../../../src/lib/core/layout/routing/endpoint-routes';
import { AssertRoute } from '../../../support/assertions/assert-route';

const configurations = [
	{
		direction: LayoutDirection.TopToBottom,
		source: { x: 20, y: 80, width: 100, height: 80 },
		target: { x: 0, y: -180, width: 140, height: 60 },
		defaultPoints: [
			{ x: 70, y: 80 },
			{ x: 70, y: -20 },
			{ x: 70, y: -20 },
			{ x: 70, y: -120 },
		],
		allocatedPoints: [
			{ x: 82, y: 80 },
			{ x: 82, y: 0 },
			{ x: 52, y: 0 },
			{ x: 52, y: -120 },
		],
	},
	{
		direction: LayoutDirection.BottomToTop,
		source: { x: 20, y: -160, width: 100, height: 80 },
		target: { x: 0, y: 120, width: 140, height: 60 },
		defaultPoints: [
			{ x: 70, y: -80 },
			{ x: 70, y: 20 },
			{ x: 70, y: 20 },
			{ x: 70, y: 120 },
		],
		allocatedPoints: [
			{ x: 82, y: -80 },
			{ x: 82, y: 0 },
			{ x: 52, y: 0 },
			{ x: 52, y: 120 },
		],
	},
	{
		direction: LayoutDirection.LeftToRight,
		source: { x: 80, y: 20, width: 80, height: 100 },
		target: { x: -180, y: 0, width: 60, height: 140 },
		defaultPoints: [
			{ x: 80, y: 70 },
			{ x: -20, y: 70 },
			{ x: -20, y: 70 },
			{ x: -120, y: 70 },
		],
		allocatedPoints: [
			{ x: 80, y: 82 },
			{ x: 0, y: 82 },
			{ x: 0, y: 52 },
			{ x: -120, y: 52 },
		],
	},
	{
		direction: LayoutDirection.RightToLeft,
		source: { x: -160, y: 20, width: 80, height: 100 },
		target: { x: 120, y: 0, width: 60, height: 140 },
		defaultPoints: [
			{ x: -80, y: 70 },
			{ x: 20, y: 70 },
			{ x: 20, y: 70 },
			{ x: 120, y: 70 },
		],
		allocatedPoints: [
			{ x: -80, y: 82 },
			{ x: 0, y: 82 },
			{ x: 0, y: 52 },
			{ x: 120, y: 52 },
		],
	},
];

describe.each(configurations)('principal endpoint routes in $direction', (configuration) => {
	const { direction, source, target } = configuration;

	it('preserves the centered four-point route when no rail or offsets are given', () => {
		const original = structuredClone({ source, target });
		expect(routePoints({ source, target, direction })).toEqual(configuration.defaultPoints);
		expect({ source, target }).toEqual(original);
	});

	it('uses the specified physical rail with different endpoint quays, including rail zero', () => {
		const original = structuredClone({ source, target });
		const points = routePoints({
			source,
			target,
			direction,
			rail: 0,
			sourceOffset: 12,
			targetOffset: -18,
		});
		expect(points).toEqual(configuration.allocatedPoints);
		AssertRoute({ id: 'route', from: 'source', to: 'target', points })
			.isOrthogonal()
			.isAttachedTo({ id: 'source', bounds: source }, { id: 'target', bounds: target });
		expect({ source, target }).toEqual(original);
	});
});
