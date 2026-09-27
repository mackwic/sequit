/** A region-owned edge with a bounded number of parallel routing tracks. */
export interface RoutingEdge {
	readonly ownerId: string;
	/** Number of tracks the edge owns. */
	readonly capacity: number;
	/** Clearance between adjacent tracks. */
	readonly spacing: number;
}
