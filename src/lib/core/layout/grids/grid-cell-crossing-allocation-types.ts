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

/** The two portal points a crossing relation leaves from, in canonical port order. */
export interface CrossingPortalSpan {
	readonly source: Point;
	readonly target: Point;
}

export interface CrossingAllocationInput {
	readonly edges: GridRoutingEdges;
	/** Crossing relation identities in canonical order. */
	readonly crossingIds: readonly string[];
	/** Relations whose endpoints use different rails and therefore use a bus track geometrically. */
	readonly busRelevantRelationIds: readonly string[];
	/** Crossing relations with an endpoint in each column, in canonical order, per column. */
	readonly gutterIds: readonly (readonly string[])[];
	readonly rowGutterIds?: readonly (readonly string[])[];
	/** An inherited incident already uses the outer track of these gutters. */
	readonly blockedExtraGutterColumns?: ReadonlySet<number> | undefined;
	/** Canonical port order per endpoint. */
	readonly incidence: ReadonlyMap<string, readonly string[]>;
	readonly portalByRelationId: ReadonlyMap<string, CrossingPortalSpan>;
}
