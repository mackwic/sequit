import { defined } from '../document/logic-document';
import { nestedRegionLocalMeasurements } from './nested-region-local-measurements';
import type { SolvedRecursiveRegion } from './nested-region-recursive-geometry';
import { leafDocument, type RecursiveContext } from './nested-region-recursive-model-adapter';
import {
	solveRegionLeafLayoutWithIncident,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-layout';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';

/** Solve the same leaf pipeline with an explicit outgoing port and passage reservation. */
export function solveContractedLaneCell(
	context: RecursiveContext,
	regionId: string,
	incident: SharedLaneOutgoingIncident,
): SolvedRecursiveRegion {
	const document = leafDocument(context, regionId);
	if (document.presentation === undefined)
		throw new UnsupportedRegionLeafLayoutError(
			`Grid cell ${regionId} has no lanes for its outgoing incident.`,
		);
	const measurements = nestedRegionLocalMeasurements(document, context.measurements);
	const policy = defined(context.model.regionsById.get(regionId)).definition.policy;
	const solved = solveRegionLeafLayoutWithIncident({
		document,
		measurements,
		policy,
		cache: context.cache,
		incident,
	});
	const labels = new Map(document.presentation.lanes.map(({ id, label }) => [id, label]));
	const layout = {
		...solved.layout,
		lanes: defined(solved.layout.lanes).map((lane) => ({
			...lane,
			regionId,
			label: defined(labels.get(lane.id)),
		})),
	};
	return {
		layout,
		ranks: solved.ranks,
		regions: [],
		portals: [],
		ownedRoutes: layout.relations.map((relation) => ({
			relationId: relation.id,
			regionId,
			points: relation.points,
		})),
		incidentPaths: new Map(),
	};
}
