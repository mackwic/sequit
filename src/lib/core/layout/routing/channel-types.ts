import type { RailRun } from './rail-packing';

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
export interface ChannelRun extends RailRun {
	start: number;
	end: number;
	readonly next: ChannelRun[];
	remaining: number;
	depth: number;
}
export interface ChannelRouting {
	readonly wires: readonly ChannelWire[];
	readonly railCount: number;
}
