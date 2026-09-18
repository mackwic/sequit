import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../../src/lib/core/document/logic-document';
import { routePoints } from '../../../../src/lib/core/layout/routing/endpoint-routes';
import { AssertRoute } from '../../../support/assertions/assert-route';

// The same two choices are made for every direction: opposite-sign endpoint offsets
// and a reserved rail of zero.
const RAIL = 0;
const SOURCE_OFFSET = 12;
const TARGET_OFFSET = -18;

// Both endpoints of every configuration sit on the same cross-axis line (`center`), so
// with no rail or offsets the default route is a straight segment on that line. Each box
// is centered on `center` (its cross-axis origin is `center - size/2`), and the allocated
// route shifts the two endpoints off the line by SOURCE_OFFSET / TARGET_OFFSET.
const topToBottom = (() => {
	const center = 70;
	return {
		direction: LayoutDirection.TopToBottom,
		source: { x: center - 50, y: 80, width: 100, height: 80 },
		target: { x: center - 70, y: -180, width: 140, height: 60 },
		defaultPoints: [
			{ x: center, y: 80 },
			{ x: center, y: -20 },
			{ x: center, y: -20 },
			{ x: center, y: -120 },
		],
		allocatedPoints: [
			{ x: center + SOURCE_OFFSET, y: 80 },
			{ x: center + SOURCE_OFFSET, y: RAIL },
			{ x: center + TARGET_OFFSET, y: RAIL },
			{ x: center + TARGET_OFFSET, y: -120 },
		],
	};
})();

const bottomToTop = (() => {
	const center = 70;
	return {
		direction: LayoutDirection.BottomToTop,
		source: { x: center - 50, y: -160, width: 100, height: 80 },
		target: { x: center - 70, y: 120, width: 140, height: 60 },
		defaultPoints: [
			{ x: center, y: -80 },
			{ x: center, y: 20 },
			{ x: center, y: 20 },
			{ x: center, y: 120 },
		],
		allocatedPoints: [
			{ x: center + SOURCE_OFFSET, y: -80 },
			{ x: center + SOURCE_OFFSET, y: RAIL },
			{ x: center + TARGET_OFFSET, y: RAIL },
			{ x: center + TARGET_OFFSET, y: 120 },
		],
	};
})();

const leftToRight = (() => {
	const center = 70;
	return {
		direction: LayoutDirection.LeftToRight,
		source: { x: 80, y: center - 50, width: 80, height: 100 },
		target: { x: -180, y: center - 70, width: 60, height: 140 },
		defaultPoints: [
			{ x: 80, y: center },
			{ x: -20, y: center },
			{ x: -20, y: center },
			{ x: -120, y: center },
		],
		allocatedPoints: [
			{ x: 80, y: center + SOURCE_OFFSET },
			{ x: RAIL, y: center + SOURCE_OFFSET },
			{ x: RAIL, y: center + TARGET_OFFSET },
			{ x: -120, y: center + TARGET_OFFSET },
		],
	};
})();

const rightToLeft = (() => {
	const center = 70;
	return {
		direction: LayoutDirection.RightToLeft,
		source: { x: -160, y: center - 50, width: 80, height: 100 },
		target: { x: 120, y: center - 70, width: 60, height: 140 },
		defaultPoints: [
			{ x: -80, y: center },
			{ x: 20, y: center },
			{ x: 20, y: center },
			{ x: 120, y: center },
		],
		allocatedPoints: [
			{ x: -80, y: center + SOURCE_OFFSET },
			{ x: RAIL, y: center + SOURCE_OFFSET },
			{ x: RAIL, y: center + TARGET_OFFSET },
			{ x: 120, y: center + TARGET_OFFSET },
		],
	};
})();

const configurations = [topToBottom, bottomToTop, leftToRight, rightToLeft];

describe.each(configurations)('principal endpoint routes in $direction', (configuration) => {
	const { direction, source, target } = configuration;

	it('preserves the centered four-point route when no rail or offsets are given', () => {
		const original = structuredClone({ source, target });
		expect(routePoints({ source, target, direction })).toEqual(configuration.defaultPoints);
		expect({ source, target }).toEqual(original);
	});

	it('uses the specified physical rail with different endpoint ports, including rail zero', () => {
		const original = structuredClone({ source, target });
		const points = routePoints({
			source,
			target,
			direction,
			rail: RAIL,
			sourceOffset: SOURCE_OFFSET,
			targetOffset: TARGET_OFFSET,
		});
		expect(points).toEqual(configuration.allocatedPoints);
		AssertRoute({ id: 'route', from: 'source', to: 'target', points })
			.isOrthogonal()
			.isAttachedTo({ id: 'source', bounds: source }, { id: 'target', bounds: target });
		expect({ source, target }).toEqual(original);
	});
});
