import { compareCanonicalStrings } from '../canonical-string';
import {
	MetricAxis,
	MetricDemandKind,
	type MinimumEndpointExtentMetricDemand,
} from './contract/metric-demand';
import { RegionPortalSide } from './region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
} from './region-incident-contract';

const PORT_INSET = 16;
const PORT_SPACING = 24;

function sideAxis(side: RegionPortalSide): MetricAxis {
	if (side === RegionPortalSide.Top || side === RegionPortalSide.Bottom) return MetricAxis.Width;
	return MetricAxis.Height;
}

/** Reserve enough transverse face length for every declared side alternative. */
export function incidentMetricDemands(
	contracts: readonly RegionIncidentContract[],
): readonly MinimumEndpointExtentMetricDemand[] {
	const counts = new Map<string, Map<RegionPortalSide, number>>();
	for (const contract of normalizeRegionIncidentContracts(contracts)) {
		const bySide = counts.get(contract.endpointId) ?? new Map<RegionPortalSide, number>();
		for (const side of contract.allowedSides) bySide.set(side, (bySide.get(side) ?? 0) + 1);
		counts.set(contract.endpointId, bySide);
	}
	const demands: MinimumEndpointExtentMetricDemand[] = [];
	for (const endpointId of [...counts.keys()].sort(compareCanonicalStrings)) {
		const bySide = counts.get(endpointId);
		if (bySide === undefined) continue;
		const minimumByAxis = new Map<MetricAxis, number>();
		for (const [side, count] of bySide) {
			const axis = sideAxis(side);
			const span = PORT_SPACING * (count - 1);
			const minimum = PORT_INSET * 2 + span;
			minimumByAxis.set(axis, Math.max(minimumByAxis.get(axis) ?? 0, minimum));
		}
		for (const axis of [MetricAxis.Width, MetricAxis.Height]) {
			const minimum = minimumByAxis.get(axis);
			if (minimum === undefined) continue;
			demands.push({
				kind: MetricDemandKind.MinimumEndpointExtent,
				endpointId,
				axis,
				minimum,
			});
		}
	}
	return demands;
}
