import { describe, expect, it } from 'vitest';

import { LayoutDirection } from '../../../../../src/lib/core/document/logic-document';
import {
	MetricAxis,
	MetricDemandKind,
	satisfyMetricDemands,
} from '../../../../../src/lib/core/layout/contract/metric-demand';
import {
	type LayoutMeasurements,
	RoutingPortRole,
} from '../../../../../src/lib/core/layout/layout-types';

const measurements: LayoutMeasurements = {
	nodes: new Map([['node', { width: 20, height: 30 }]]),
	junctions: new Map([['junction', { width: 8, height: 8 }]]),
	groups: new Map([
		['group', { minimumWidth: 40, minimumHeight: 50, headerHeight: 10, padding: 8 }],
	]),
};

describe('metric demands shared by parent and local layout', () => {
	it('joins minimum extents before solving while preserving intrinsic measurements', () => {
		const demanded = satisfyMetricDemands(
			measurements,
			[
				{
					kind: MetricDemandKind.MinimumEndpointExtent,
					endpointId: 'node',
					axis: MetricAxis.Height,
					minimum: 56,
				},
				{
					kind: MetricDemandKind.MinimumEndpointExtent,
					endpointId: 'node',
					axis: MetricAxis.Height,
					minimum: 52,
				},
				{
					kind: MetricDemandKind.MinimumEndpointExtent,
					endpointId: 'junction',
					axis: MetricAxis.Width,
					minimum: 16,
				},
				{
					kind: MetricDemandKind.MinimumEndpointExtent,
					endpointId: 'group',
					axis: MetricAxis.Height,
					minimum: 80,
				},
				{
					kind: MetricDemandKind.MinimumEndpointExtent,
					endpointId: 'group',
					axis: MetricAxis.Width,
					minimum: 72,
				},
			],
			LayoutDirection.TopToBottom,
		);
		expect(demanded.nodes.get('node')).toEqual({ width: 20, height: 56 });
		expect(demanded.junctions.get('junction')).toEqual({ width: 16, height: 8 });
		expect(demanded.groups.get('group')).toMatchObject({ minimumWidth: 72, minimumHeight: 80 });
		expect(measurements.nodes.get('node')).toEqual({ width: 20, height: 30 });
		expect(measurements.groups.get('group')).toMatchObject({ minimumWidth: 40, minimumHeight: 50 });
		expect(satisfyMetricDemands(measurements, [], LayoutDirection.TopToBottom)).toBe(measurements);
	});

	it.each([
		[LayoutDirection.TopToBottom, { width: 64, height: 30 }],
		[LayoutDirection.BottomToTop, { width: 64, height: 30 }],
		[LayoutDirection.LeftToRight, { width: 20, height: 64 }],
		[LayoutDirection.RightToLeft, { width: 20, height: 64 }],
	])('maps face capacity to the physical cross axis in %s', (direction, expected) => {
		const result = satisfyMetricDemands(
			measurements,
			[
				{
					endpointId: 'node',
					role: RoutingPortRole.Incoming,
					portCount: 3,
					minimumCrossSize: 64,
					growth: 44,
				},
			],
			direction,
		);
		expect(result.nodes.get('node')).toEqual(expected);
	});

	it('rejects invalid or unbound demands before any local solve', () => {
		for (const minimum of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() =>
				satisfyMetricDemands(
					measurements,
					[
						{
							kind: MetricDemandKind.MinimumEndpointExtent,
							endpointId: 'node',
							axis: MetricAxis.Height,
							minimum,
						},
					],
					LayoutDirection.TopToBottom,
				),
			).toThrow('Invalid metric demand for endpoint node.');
		expect(() =>
			satisfyMetricDemands(
				measurements,
				[
					{
						kind: MetricDemandKind.MinimumEndpointExtent,
						endpointId: 'missing',
						axis: MetricAxis.Height,
						minimum: 16,
					},
				],
				LayoutDirection.TopToBottom,
			),
		).toThrow('Unknown metric endpoint missing');
	});
});
