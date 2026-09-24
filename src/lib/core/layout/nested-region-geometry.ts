import type { LogicGraph } from '../graph/create-graph';
import { validateNestedRegionLeafIncidents } from './nested-region-leaf-incident-validation';
import { validateNestedPlacements } from './nested-region-placement-validation';
import { validateNestedRouteOwnership } from './nested-region-route-validation';
import {
	NestedPortalSide,
	type NestedRegionInput,
	type NestedRegionSelected,
} from './nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from './region-composition-model';
import { validateRegionCompositionGeometry } from './region-composition-validation';

/** Separate materialization check: confinement, portals, ownership and opacity. */
export function validateNestedRegionGeometry(
	graph: LogicGraph,
	input: NestedRegionInput,
	candidate: NestedRegionSelected,
): string | undefined {
	const normalized = normalizeRegionCompositionModel(graph, input);
	if (normalized.status !== RegionCompositionModelStatus.Ready)
		return normalized.diagnostic.message;
	const nested = [...normalized.model.regionsById.values()].some(({ depth }) => depth > 1);
	const lateral = candidate.portals.some(
		({ side }) => side === NestedPortalSide.Left || side === NestedPortalSide.Right,
	);
	if (nested || lateral)
		return (
			validateRegionCompositionGeometry(normalized.model, candidate) ??
			validateNestedRegionLeafIncidents(normalized.model, candidate)
		);
	return (
		validateNestedPlacements(candidate) ?? validateNestedRouteOwnership(graph, input, candidate)
	);
}
