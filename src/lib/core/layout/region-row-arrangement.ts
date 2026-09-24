import type { LayoutRelation, LayoutResult } from './layout-types';
import { composeCrossings, inheritedIncidentPaths } from './nested-region-recursive-composition';
import {
	childPlacements,
	rowSize,
	type SolvedRecursiveRegion,
	sortedElements,
	translatedChildren,
} from './nested-region-recursive-geometry';
import { NestedPortalSide } from './nested-region-types';
import type {
	ArrangementIncidentInput,
	ArrangementPlaceInput,
	ArrangementRouteInput,
	RegionArrangement,
} from './region-arrangement';
import { RegionPortalSide } from './region-composition-types';
import { UnsupportedRegionLeafLayoutError } from './region-leaf-base-layout';

interface RowPlaced {
	readonly placements: ReturnType<typeof childPlacements>;
	readonly size: ReturnType<typeof rowSize>;
}

function rowSide(side: RegionPortalSide): NestedPortalSide {
	if (side === RegionPortalSide.Top) return NestedPortalSide.Top;
	if (side === RegionPortalSide.Bottom) return NestedPortalSide.Bottom;
	throw new UnsupportedRegionLeafLayoutError(`A row has no ${side} routing disposition.`);
}

function incidentSides(input: ArrangementIncidentInput): readonly RegionPortalSide[] {
	if (input.inheritedSides !== undefined) return input.inheritedSides;
	rowSide(input.preferredSide);
	return [input.preferredSide];
}

function place(input: ArrangementPlaceInput): RowPlaced {
	const side = rowSide(input.preferredSide);
	const placements = childPlacements(input.regionId, input.children, side, input.crossings.length);
	return {
		placements,
		size: rowSize(placements, side, input.crossings.length),
	};
}

function route(input: ArrangementRouteInput<RowPlaced>): SolvedRecursiveRegion {
	const { context, regionId, children, crossings, placement } = input;
	const localSide = rowSide(input.preferredSide);
	const { placements, size } = placement;
	const placed = translatedChildren(children, placements);
	const relationsById = new Map(placed.relations.map((relation) => [relation.id, relation]));
	const portals = [...placed.portals];
	const ownedRoutes = [...placed.ownedRoutes];
	composeCrossings({
		context,
		regionId,
		children,
		placements,
		crossings,
		localSide,
		bottomBusEdge: size.bottomBusEdge,
		relationsById,
		portals,
		ownedRoutes,
	});
	let layout: LayoutResult = {
		width: size.width,
		height: size.height,
		elements: sortedElements(placed.elements),
		relations: context.graph.relations.flatMap(({ relation }): readonly LayoutRelation[] => {
			const selected = relationsById.get(relation.id);
			if (selected === undefined) return [];
			return [selected];
		}),
	};
	if (placed.lanes.length > 0) layout = { ...layout, lanes: placed.lanes };
	const incidentPaths = inheritedIncidentPaths({
		context,
		regionId,
		children,
		placements,
		incidentSides: input.incidentSides,
		layoutWidth: layout.width,
		layoutHeight: layout.height,
	});
	return {
		layout,
		ranks: { byEndpointId: new Map(), bands: [] },
		regions: placed.regions,
		portals,
		ownedRoutes,
		incidentPaths,
	};
}

/** The row disposition preserves the established placement and bus route order. */
export const rowRegionArrangement: RegionArrangement<RowPlaced> = {
	incidentSides,
	place,
	route,
};
