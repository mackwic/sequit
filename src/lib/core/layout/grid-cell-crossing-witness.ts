import type { BoundedSearchWitness } from './bounded-search';
import type { RegionGeometryDiagnosticCode } from './region-geometry-diagnostic';

/** One declared attempt of the crossing allocation search, in search order. */
export enum CrossingAllocationPhaseId {
	/** Permute tracks and portals: the reallocation issue of the routing resource graph. */
	Reallocate = 'reallocate',
	/** Add one rail track: the growth issue, already reserved by the margin. */
	ExtraTrack = 'extra-track',
	/** Reallocate again, now accepting a crossing that a validated bridge carries. */
	Bridge = 'bridge',
}

interface GridCrossingAllocationPhaseWitness {
	readonly id: CrossingAllocationPhaseId;
	readonly attempted: boolean;
	readonly exploredGeometries: number;
	readonly totalGeometries: string;
	/** True only when every candidate declared for this phase was examined. */
	readonly exhaustive: boolean;
	/** True when the phase stopped at its budget before selecting or exhausting its candidates. */
	readonly truncated: boolean;
	readonly selected: boolean;
}

interface GridCrossingAllocationRejectedAlternative {
	readonly phaseId: CrossingAllocationPhaseId;
	readonly busOrder: readonly string[];
	readonly code: RegionGeometryDiagnosticCode;
	readonly reason: string;
}

/** Bounded grid evidence with exact per-phase route geometry counts. */
export interface GridCrossingAllocationWitness extends BoundedSearchWitness<GridCrossingAllocationRejectedAlternative> {
	readonly phases: readonly GridCrossingAllocationPhaseWitness[];
	readonly winningPhase?: CrossingAllocationPhaseId;
}

/** Search evidence for a selected allocation always records the phase that won. */
export interface GridCrossingAllocationSelectedWitness extends GridCrossingAllocationWitness {
	readonly winningPhase: CrossingAllocationPhaseId;
}
