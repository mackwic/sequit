import type { Point } from '../layout-types';
import type { GridRoutingEdges } from './grid-cell-crossing';

/** One allocated track per crossing relation, on each gutter edge and on the bus. */
export interface GridCrossingAllocation {
	/** One track map per column gutter, in column order. */
	readonly gutterTrackByRelationId: readonly ReadonlyMap<string, number>[];
	readonly busTrackByRelationId: ReadonlyMap<string, number>;
	/** Allocated horizontal tracks, by row boundary; an absent relation uses the top bus. */
	readonly rowTrackByRelationId?: readonly ReadonlyMap<string, number>[];
	readonly portTrackByEndpointId: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** One end of a crossing relation: its endpoint, the endpoint's cell and its declared portal. */
export interface CrossingPortal {
	readonly endpointId: string;
	readonly row: number;
	readonly column: number;
	readonly point: Point;
}

/** The two portals a crossing relation leaves from, by role, at their documentary ports. */
export interface CrossingPortalSpan {
	readonly source: CrossingPortal;
	readonly target: CrossingPortal;
}

export interface CrossingAllocationInput {
	readonly edges: GridRoutingEdges;
	/** Crossing relation identities in documentary order. */
	readonly crossingIds: readonly string[];
	/** Relations whose endpoints use different rails, in documentary order. */
	readonly busRelevantRelationIds: readonly string[];
	/** Crossing relations with an endpoint in each column, in documentary order, per column. */
	readonly gutterIds: readonly (readonly string[])[];
	readonly rowGutterIds?: readonly (readonly string[])[];
	/** An inherited incident already uses the outer track of these gutters. */
	readonly blockedExtraGutterColumns?: ReadonlySet<number> | undefined;
	/** Documentary port order per endpoint. */
	readonly incidence: ReadonlyMap<string, readonly string[]>;
	readonly portalByRelationId: ReadonlyMap<string, CrossingPortalSpan>;
}
