import type { LogicGraph } from '../graph/create-graph';
import type { RouteBridgeCache } from './bridges/bridge-oracle';
import { validateNestedRegionLeafIncidents } from './nested-region-leaf-incident-validation';
import { validateNestedPlacements } from './nested-region-placement-validation';
import { validateNestedRouteOwnership } from './nested-region-route-validation';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from './region-composition-model';
import {
	type RegionInput,
	type RegionLayoutSelected,
	RegionPortalSide,
} from './region-composition-types';
import { validateRegionCompositionGeometry } from './region-composition-validation';

/** Separate materialization check: confinement, portals, ownership and opacity. */
export function validateNestedRegionGeometry(
	graph: LogicGraph,
	input: RegionInput,
	candidate: RegionLayoutSelected,
): string | undefined {
	const normalized = normalizeRegionCompositionModel(graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return normalized.diagnostic.message;
	const nested = [...normalized.model.regionsById.values()].some(({ depth }) => depth > 1);
	const lateral = candidate.portals.some(
		({ side }) => side === RegionPortalSide.Left || side === RegionPortalSide.Right,
	);
	if (nested || lateral) {
		const bridgeCache: RouteBridgeCache = {};
		return (
			validateRegionCompositionGeometry(normalized.model, candidate, bridgeCache)?.message ??
			validateNestedRegionLeafIncidents(normalized.model, candidate, bridgeCache)?.message
		);
	}
	return (
		validateNestedPlacements(candidate) ?? validateNestedRouteOwnership(graph, input, candidate)
	);
}
