import { defined } from '../document/logic-document';
import type { SolvedRecursiveRegion } from './regions/model/nested-region-recursive-geometry';
import {
	directChild,
	type IncidentSides,
	type RecursiveContext,
	sideForRegion,
} from './regions/model/nested-region-recursive-model-adapter';
import type {
	ArrangementIncidentInput,
	RegionArrangement,
} from './regions/model/region-arrangement';
import type { RegionPortalSide } from './regions/model/region-composition-types';
import { RegionIncidentRole } from './regions/model/region-incident-contract';

interface ChildSidesInput<Placement> {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly childId: string;
	readonly incidentSides: IncidentSides;
	readonly preferredSide: RegionPortalSide;
	readonly arrangement: RegionArrangement<Placement>;
}

function requestedChildSides<Placement>(input: ChildSidesInput<Placement>): IncidentSides {
	const { context, regionId, childId, incidentSides, preferredSide, arrangement } = input;
	const sides = new Map<string, readonly RegionPortalSide[]>();
	for (const owned of context.model.relations) {
		const inheritedSides = incidentSides.get(owned.relation.id);
		if (owned.ownerId !== regionId && inheritedSides === undefined) continue;
		const sourceHere = owned.ownerId === regionId || owned.sourcePathToOwner.includes(regionId);
		const targetHere = owned.ownerId === regionId || owned.targetPathToOwner.includes(regionId);
		let role: RegionIncidentRole | undefined;
		if (sourceHere && directChild(context, regionId, owned.relation.from) === childId)
			role = RegionIncidentRole.Source;
		if (targetHere && directChild(context, regionId, owned.relation.to) === childId)
			role = RegionIncidentRole.Target;
		if (role === undefined) continue;
		let request: ArrangementIncidentInput = {
			context,
			regionId,
			childId,
			relation: owned.relation,
			role,
			preferredSide,
		};
		if (inheritedSides !== undefined) request = { ...request, inheritedSides };
		sides.set(owned.relation.id, arrangement.incidentSides(request));
	}
	return sides;
}

export interface ArrangedRegionInput<Placement> {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly incidentSides: IncidentSides;
	readonly arrangement: RegionArrangement<Placement>;
	readonly solveChild: (
		context: RecursiveContext,
		regionId: string,
		incidentSides: IncidentSides,
	) => SolvedRecursiveRegion;
}

/** Apply a disposition's side, placement and route contract to direct children. */
export function solveArrangedRegion<Placement>(
	input: ArrangedRegionInput<Placement>,
): SolvedRecursiveRegion {
	const { context, regionId, incidentSides, arrangement, solveChild } = input;
	const region = defined(context.model.regionsById.get(regionId));
	const preferredSide = sideForRegion(context, regionId);
	const crossings = context.graph.relations
		.map(({ relation }) => relation)
		.filter((relation) => context.ownershipByRelationId.get(relation.id)?.ownerId === regionId);
	const children = region.childIds.map((id) => ({
		id,
		solved: solveChild(
			context,
			id,
			requestedChildSides({
				context,
				regionId,
				childId: id,
				incidentSides,
				preferredSide,
				arrangement,
			}),
		),
	}));
	const placement = arrangement.place({
		context,
		regionId,
		children,
		crossings,
		preferredSide,
	});
	return arrangement.route({
		context,
		regionId,
		children,
		crossings,
		preferredSide,
		placement,
		incidentSides,
	});
}
