import { describe, expect, it } from 'vitest';

import {
	compareDedicatedRouteScores,
	scoreDedicatedCandidateRoutes,
} from '../../../../src/lib/core/layout/dedicated-candidate-validation';
import type { LayoutResult } from '../../../../src/lib/core/layout/layout-types';

const crossingLayout: LayoutResult = {
	width: 100,
	height: 100,
	elements: [],
	relations: [
		{
			id: 'horizontal',
			from: 'west',
			to: 'east',
			points: [
				{ x: 10, y: 50 },
				{ x: 90, y: 50 },
			],
		},
		{
			id: 'vertical',
			from: 'north',
			to: 'south',
			points: [
				{ x: 50, y: 10 },
				{ x: 50, y: 90 },
			],
		},
	],
};

describe('dedicated candidate route scoring', () => {
	it('scores materialized crossings, validated bridges, Manhattan length, and bends', () => {
		expect(scoreDedicatedCandidateRoutes(crossingLayout)).toEqual({
			strictCrossings: 1,
			validatedBridges: 1,
			length: 160,
			bends: 0,
		});
	});

	it('compares crossings and bridges lexicographically, not observed length or bends', () => {
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 2, validatedBridges: 1, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 1, length: 100, bends: 100 },
			),
		).toBe(0);
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 2, validatedBridges: 2, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 1, length: 100, bends: 100 },
			),
		).toBe(1);
		expect(
			compareDedicatedRouteScores(
				{ strictCrossings: 1, validatedBridges: 9, length: 1, bends: 1 },
				{ strictCrossings: 2, validatedBridges: 0, length: 100, bends: 100 },
			),
		).toBe(-1);
	});
});
