import type { LogicRelation } from '../document/logic-document';
import type { SolvedRecursiveRegion } from './nested-region-recursive-geometry';
import type { RecursiveContext } from './nested-region-recursive-model-adapter';
import type { RegionPortalSide } from './region-composition-types';
import type { RegionIncidentRole } from './region-incident-contract';

type ArrangementIncidentSides = ReadonlyMap<string, readonly RegionPortalSide[]>;

export interface ArrangementIncidentInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly childId: string;
	readonly relation: LogicRelation;
	readonly role: RegionIncidentRole;
	/** A relation inherited from this region's parent keeps its frame-side preferences. */
	readonly inheritedSides?: readonly RegionPortalSide[];
	readonly preferredSide: RegionPortalSide;
}

interface ArrangementChild {
	readonly id: string;
	readonly solved: SolvedRecursiveRegion;
}

export interface ArrangementPlaceInput {
	readonly context: RecursiveContext;
	readonly regionId: string;
	readonly children: readonly ArrangementChild[];
	readonly crossings: readonly LogicRelation[];
	readonly preferredSide: RegionPortalSide;
}

export interface ArrangementRouteInput<Placement> extends ArrangementPlaceInput {
	readonly placement: Placement;
	readonly incidentSides: ArrangementIncidentSides;
}

/** Region arrangement owns admissible sides, child placement, and owned routes. */
export interface RegionArrangement<Placement> {
	incidentSides(input: ArrangementIncidentInput): readonly RegionPortalSide[];
	place(input: ArrangementPlaceInput): Placement;
	route(input: ArrangementRouteInput<Placement>): SolvedRecursiveRegion;
}
