/** Same resource-edge shape as the shared graph; routing does not depend outward on resources. */
export interface ChannelRoutingEdge {
	readonly ownerId: string;
	readonly capacity: number;
	readonly spacing: number;
}

export interface ChannelEndpoint {
	readonly id: string;
	readonly source: number;
	readonly target: number;
	readonly sharedTarget?: string | undefined;
	readonly sharedSource?: string | undefined;
}
export interface ChannelWire extends ChannelEndpoint {
	first: ChannelRun | undefined;
	last: ChannelRun | undefined;
	middle: number | undefined;
}
export interface ChannelRun {
	/** Assigned after family merging, in topological visitation order. */
	key: number;
	/** Assigned track on the channel edge. */
	rail: number;
	start: number;
	end: number;
	readonly next: ChannelRun[];
	remaining: number;
	depth: number;
}
export interface ChannelRailAllocation {
	readonly edge: ChannelRoutingEdge;
	readonly trackByRunKey: ReadonlyMap<number, number>;
	readonly railCount: number;
}
export interface ChannelRouting extends ChannelRailAllocation {
	readonly wires: readonly ChannelWire[];
}
