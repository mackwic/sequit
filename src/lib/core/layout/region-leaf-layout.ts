import type { LayoutPolicy, LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import { topologicallyRank } from '../graph/topological-ranks';
import type { LayoutMeasurements } from './layout-types';
import type {
	NestedRegionLocalLayout,
	NestedRegionLocalLayoutCache,
} from './nested-region-local-cache';
import { RegionCompositionStatus } from './region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from './region-incident-contract';
import {
	InvalidRegionLeafGraphError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-base-layout';
import { solveDedicatedRegionLeafWithIncidents } from './region-leaf-incident-solver';
import { SharedLaneLayoutStatus, solveSharedLaneLayout } from './shared-lane-layout';

export {
	InvalidRegionLeafGraphError,
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-base-layout';

export interface RegionLeafIncidentInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy?: LayoutPolicy | undefined;
	readonly cache?: NestedRegionLocalLayoutCache | undefined;
	readonly contracts: readonly RegionIncidentContract[];
}

interface RegionLeafIncidentSelected {
	readonly status: RegionCompositionStatus.Selected;
	readonly layout: NestedRegionLocalLayout['layout'];
	readonly ranks: NestedRegionLocalLayout['ranks'];
	readonly incidents: NonNullable<NestedRegionLocalLayout['incidents']>;
	readonly witness: NonNullable<NestedRegionLocalLayout['witness']>;
}

interface RegionLeafIncidentUnknown {
	readonly status: RegionCompositionStatus.Unknown;
	readonly code: RegionIncidentUnknownCode;
	readonly reason: string;
	readonly witness: RegionIncidentSearchWitness;
}

export type RegionLeafIncidentAttempt = RegionLeafIncidentSelected | RegionLeafIncidentUnknown;

function emptyWitness(): RegionIncidentSearchWitness {
	return { attempted: 0, exhaustive: true, rejectedAlternatives: [] };
}

class UncacheableLaneIncidentFailure extends Error {
	constructor(readonly attempt: RegionLeafIncidentUnknown) {
		super(attempt.reason);
	}
}

/** Both leaf policies receive the full normalized incident set, including an empty set. */
export function solveRegionLeafLayoutWithIncidents(
	input: RegionLeafIncidentInput,
): RegionLeafIncidentAttempt {
	let contracts: readonly RegionIncidentContract[];
	try {
		contracts = normalizeRegionIncidentContracts(input.contracts);
	} catch (error) {
		return {
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.InvalidContract,
			reason: String(error),
			witness: emptyWitness(),
		};
	}
	if (input.document.presentation === undefined)
		return solveDedicatedRegionLeafWithIncidents({ ...input, contracts });
	const compute = (): NestedRegionLocalLayout => {
		const graph = createGraph(input.document);
		if (!graph.ok) throw new InvalidRegionLeafGraphError();
		const ranks = topologicallyRank(graph.value);
		const attempt = solveSharedLaneLayout(graph.value, ranks, input.measurements, {
			incidents: contracts,
		});
		if (attempt.status === SharedLaneLayoutStatus.Unsupported)
			throw new UnsupportedRegionLeafLayoutError(attempt.reason);
		if (attempt.status === SharedLaneLayoutStatus.Unknown) {
			const unknown: RegionLeafIncidentUnknown = {
				status: RegionCompositionStatus.Unknown,
				code: attempt.code,
				reason: attempt.reason,
				witness: attempt.witness,
			};
			throw new UncacheableLaneIncidentFailure(unknown);
		}
		return {
			layout: attempt.layout,
			ranks,
			incidents: attempt.incidents,
			witness: attempt.witness,
		};
	};
	try {
		const solved =
			input.cache?.getOrComputeContract({
				document: input.document,
				measurements: input.measurements,
				policy: input.policy,
				contracts,
				compute,
			}) ?? compute();
		if (solved.incidents === undefined || solved.witness === undefined)
			throw new Error('A cached lane leaf omitted its incident solution.');
		return {
			status: RegionCompositionStatus.Selected,
			layout: solved.layout,
			ranks: solved.ranks,
			incidents: solved.incidents,
			witness: solved.witness,
		};
	} catch (error) {
		if (error instanceof UncacheableLaneIncidentFailure) return error.attempt;
		throw error;
	}
}
