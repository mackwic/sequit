import { defined, LayoutPolicy, type LogicDocument } from '../../../document/logic-document';
import { createGraph } from '../../../graph/create-graph';
import { topologicallyRank } from '../../../graph/topological-ranks';
import {
	enumerateSharedLaneLayouts,
	type LaneCandidateSearchWitness,
} from '../../lanes/shared-lane-candidate-enumeration';
import { SharedLaneLayoutStatus, solveSharedLaneLayout } from '../../lanes/shared-lane-layout';
import type { LayoutMeasurements } from '../../layout-types';
import { RegionCompositionStatus } from '../model/region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
} from '../model/region-incident-contract';
import type { RegionLocalLayout, RegionLocalLayoutCache } from '../model/region-local-cache';
import {
	InvalidRegionLeafGraphError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-base-layout';
import {
	enumerateDedicatedRegionLeafWithIncidents,
	solveDedicatedRegionLeafWithIncidents,
} from './region-leaf-incident-solver';
import { regionLeafPolicyFailure } from './region-leaf-policy';

export {
	InvalidRegionLeafGraphError,
	solveRegionLeafLayout,
	UnknownRegionLeafLayoutError,
	UnsupportedRegionLeafLayoutError,
} from './region-leaf-base-layout';

export interface RegionLeafIncidentInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly leafPolicy: LayoutPolicy;
	readonly cache?: RegionLocalLayoutCache | undefined;
	readonly contracts: readonly RegionIncidentContract[];
}

export interface RegionLeafIncidentSelected {
	readonly status: RegionCompositionStatus.Selected;
	readonly layout: RegionLocalLayout['layout'];
	readonly ranks: RegionLocalLayout['ranks'];
	readonly incidents: NonNullable<RegionLocalLayout['incidents']>;
	readonly witness: NonNullable<RegionLocalLayout['witness']>;
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
	const policyFailure = regionLeafPolicyFailure(input.leafPolicy, input.document);
	if (policyFailure !== undefined)
		return {
			status: RegionCompositionStatus.Unknown,
			code: RegionIncidentUnknownCode.UnsupportedLeafPolicy,
			reason: policyFailure,
			witness: emptyWitness(),
		};
	if (input.leafPolicy === LayoutPolicy.Layered)
		return solveDedicatedRegionLeafWithIncidents({ ...input, contracts });
	const compute = (): RegionLocalLayout => {
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
				policy: input.leafPolicy,
				contracts,
				compute,
			}) ?? compute();
		// Every cache writer defines both fields for this key: the lane compute above, the
		// dedicated leaf compute, and `region-leaf-base-layout`'s compute, while the key carries
		// the policy and the normalized contracts.
		const incidents = defined(solved.incidents);
		const witness = defined(solved.witness);
		return {
			status: RegionCompositionStatus.Selected,
			layout: solved.layout,
			ranks: solved.ranks,
			incidents,
			witness,
		};
	} catch (error) {
		if (error instanceof UncacheableLaneIncidentFailure) return error.attempt;
		throw error;
	}
}

function* laneLeafAlternatives(
	input: RegionLeafIncidentInput,
): Generator<RegionLeafIncidentSelected, LaneCandidateSearchWitness, void> {
	const graph = createGraph(input.document);
	if (!graph.ok) throw new InvalidRegionLeafGraphError();
	const ranks = topologicallyRank(graph.value);
	const search = enumerateSharedLaneLayouts(graph.value, ranks, input.measurements, {
		incidents: input.contracts,
	});
	for (;;) {
		const candidate = search.next();
		if (candidate.done === true) return candidate.value;
		yield {
			status: RegionCompositionStatus.Selected,
			layout: candidate.value.layout,
			ranks,
			incidents: candidate.value.incidents,
			witness: candidate.value.witness,
		};
	}
}

/** The first pull follows the existing cached policy. Further local alternatives are explored
 * only when the composition asks for them; neither policy changes production selection here. */
export function* enumerateRegionLeafLayoutsWithIncidents(
	input: RegionLeafIncidentInput,
): Generator<
	RegionLeafIncidentSelected,
	RegionIncidentSearchWitness | LaneCandidateSearchWitness,
	void
> {
	if (input.leafPolicy === LayoutPolicy.Layered)
		return yield* enumerateDedicatedRegionLeafWithIncidents(input);
	const first = solveRegionLeafLayoutWithIncidents(input);
	if (first.status === RegionCompositionStatus.Unknown) return first.witness;
	yield first;
	const search = laneLeafAlternatives(input);
	search.next();
	return yield* search;
}
