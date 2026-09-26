import { describe, expect, it } from 'vitest';

import {
	MetricAxis,
	MetricDemandKind,
} from '../../../../src/lib/core/layout/contract/metric-demand';
import { incidentMetricDemands } from '../../../../src/lib/core/layout/region-incident-metric-demand';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import {
	type RegionIncidentContract,
	RegionIncidentRole,
} from '../../../../src/lib/core/layout/regions/model/region-incident-contract';

function contract(id: string, sides: readonly RegionPortalSide[]): RegionIncidentContract {
	return {
		relation: { id, from: 'leaf', to: 'outside' },
		endpointId: 'leaf',
		role: RegionIncidentRole.Source,
		allowedSides: sides,
	};
}

describe('incident metric demand', () => {
	it('reserves independent transverse capacity for horizontal and vertical frame sides', () => {
		const contracts = [
			contract('a', [RegionPortalSide.Top, RegionPortalSide.Right]),
			contract('b', [RegionPortalSide.Top, RegionPortalSide.Right]),
			contract('c', [RegionPortalSide.Right]),
		];
		const expected = [
			{
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId: 'leaf',
				axis: MetricAxis.Width,
				minimum: 56,
			},
			{
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId: 'leaf',
				axis: MetricAxis.Height,
				minimum: 80,
			},
		];
		expect(incidentMetricDemands(contracts)).toEqual(expected);
		expect(incidentMetricDemands(contracts.toReversed())).toEqual(expected);
	});

	it('does not multiply demand when the same contract is supplied twice', () => {
		const crossing = contract('same', [RegionPortalSide.Left]);
		expect(incidentMetricDemands([crossing, crossing])).toEqual([
			{
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId: 'leaf',
				axis: MetricAxis.Height,
				minimum: 32,
			},
		]);
	});
});
