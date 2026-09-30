import { defined, LayoutPolicy, type LogicDocument } from '../../../document/logic-document';
import type { TopologicalRanks } from '../../../graph/topological-ranks';
import { satisfyMetricDemands } from '../../contract/metric-demand';
import type { LayoutMeasurements, LayoutResult } from '../../layout-types';
import { validDepthFirst } from '../../search/bounded-search';
import { RegionCompositionStatus, type RegionPortalSide } from '../model/region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from '../model/region-incident-contract';
import type { RegionLocalLayout, RegionLocalLayoutCache } from '../model/region-local-cache';
import { incidentMetricDemands } from './region-incident-metric-demand';
import { solveRegionLeafLayout } from './region-leaf-base-layout';
import {
	faceAnchor,
	type FaceSlot,
	geometryFailure,
	type RegionLeafIncidentGeometryFailure,
	routeCandidates,
	routeFor,
	slotFractions,
	slotsForAssignment,
} from './region-leaf-incident-geometry';
import {
	exhaustedBudgetReason,
	newSearchState,
	recordRejection,
	type SearchState,
	witness,
} from './region-leaf-incident-search-state';
import { regionLeafPolicyFailure } from './region-leaf-policy';

export interface DedicatedRegionLeafIncidentInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly contracts: readonly RegionIncidentContract[];
	readonly endpointPositions?: ReadonlyMap<string, number> | undefined;
	readonly cache?: RegionLocalLayoutCache | undefined;
}

interface DedicatedRegionLeafIncidentSelected {
	readonly status: RegionCompositionStatus.Selected;
	readonly layout: LayoutResult;
	readonly ranks: TopologicalRanks;
	readonly incidents: readonly RegionSolvedIncident[];
	readonly witness: RegionIncidentSearchWitness;
}

interface DedicatedRegionLeafIncidentUnknown {
	readonly status: RegionCompositionStatus.Unknown;
	readonly code: RegionIncidentUnknownCode;
	readonly reason: string;
	readonly witness: RegionIncidentSearchWitness;
}

export type DedicatedRegionLeafIncidentAttempt =
	DedicatedRegionLeafIncidentSelected | DedicatedRegionLeafIncidentUnknown;

function unknown(
	code: RegionIncidentUnknownCode,
	reason: string,
	state: SearchState,
	exhaustive: boolean,
): DedicatedRegionLeafIncidentUnknown {
	return {
		status: RegionCompositionStatus.Unknown,
		code,
		reason,
		witness: witness(state, exhaustive),
	};
}

function candidateId(points: readonly { readonly x: number; readonly y: number }[]): string {
	return points.map(({ x, y }) => `${x},${y}`).join(';');
}

/** Every route of one slot: the preferred face fraction first, then the declared fallbacks. */
function* routeChoices(
	contract: RegionIncidentContract,
	slot: FaceSlot,
	endpoint: LayoutResult['elements'][number],
	layout: LayoutResult,
): Generator<RegionSolvedIncident> {
	for (const fraction of slotFractions(slot.preferredFraction)) {
		const anchor = faceAnchor(endpoint.bounds, slot.side, fraction);
		for (const points of routeCandidates(anchor, slot.side, layout))
			yield routeFor(contract, slot.side, points);
	}
}

/** Shared local route search for the initial selection and its subsequent alternatives. */
function* routesOnLayout(
	contracts: readonly RegionIncidentContract[],
	layout: LayoutResult,
	endpoints: readonly LayoutResult['elements'][number][],
	state: SearchState,
): Generator<readonly RegionSolvedIncident[], void, void> {
	const sides: RegionPortalSide[] = [];
	function* routeAt(
		slotSides: readonly RegionPortalSide[],
	): Generator<readonly RegionSolvedIncident[]> {
		const slots = slotsForAssignment(contracts, slotSides, state.slotBudget);
		if (slots === undefined) {
			state.incomplete = true;
			return;
		}
		yield* validDepthFirst<RegionSolvedIncident, RegionLeafIncidentGeometryFailure>({
			levels: contracts.length,
			counter: state.budget,
			choices: (level) =>
				routeChoices(
					defined(contracts[level]),
					defined(slots[level]),
					defined(endpoints[level]),
					layout,
				),
			accept: (level, path, selected) =>
				geometryFailure(layout, defined(endpoints[level]), path, selected),
			onReject: (level, path, failure) => {
				recordRejection(state, defined(contracts[level]), path.side, {
					...failure,
					candidateId: candidateId(path.points),
				});
			},
			onExhausted: (level) => {
				recordRejection(state, defined(contracts[level]), defined(slots[level]).side, {
					code: RegionIncidentRejectionCode.GeometryInvalid,
					reason: 'This incident side has no joint route with the other contracts.',
					exhausted: true,
				});
			},
		});
	}
	function* assignSides(index: number): Generator<readonly RegionSolvedIncident[]> {
		if (index === contracts.length) {
			state.assignmentAttempts = 0;
			state.assignmentLimitReached = false;
			yield* routeAt(sides);
			return;
		}
		const contract = defined(contracts[index]);
		for (const side of contract.allowedSides) {
			sides.push(side);
			yield* assignSides(index + 1);
			sides.pop();
			if (state.budgetExceeded || state.slotBudgetExceeded) return;
		}
	}
	yield* assignSides(0);
}

function solveOnLayout(
	contracts: readonly RegionIncidentContract[],
	layout: LayoutResult,
	ranks: TopologicalRanks,
): DedicatedRegionLeafIncidentAttempt {
	const state = newSearchState();
	if (contracts.length === 0)
		return {
			status: RegionCompositionStatus.Selected,
			layout,
			ranks,
			incidents: [],
			witness: witness(state, true),
		};
	const elements = new Map(layout.elements.map((element) => [element.id, element]));
	for (const contract of contracts) {
		if (elements.has(contract.endpointId)) continue;
		for (const side of contract.allowedSides) {
			if (!state.globalBudget.take())
				return unknown(
					RegionIncidentUnknownCode.SearchBudgetExceeded,
					exhaustedBudgetReason(state),
					state,
					false,
				);
			recordRejection(state, contract, side, {
				code: RegionIncidentRejectionCode.PortUnavailable,
				reason: `The local layout has no endpoint ${contract.endpointId}.`,
			});
		}
	}
	if (state.rejected.length > 0)
		return unknown(
			RegionIncidentUnknownCode.NoValidAlternative,
			'A declared incident endpoint is absent from the local layout.',
			state,
			true,
		);
	const endpoints = contracts.map((contract) => defined(elements.get(contract.endpointId)));
	const incidents = routesOnLayout(contracts, layout, endpoints, state).next().value;
	if (incidents !== undefined)
		return {
			status: RegionCompositionStatus.Selected,
			layout,
			ranks,
			incidents,
			witness: witness(state, false),
		};
	if (state.budgetExceeded || state.incomplete)
		return unknown(
			RegionIncidentUnknownCode.SearchBudgetExceeded,
			exhaustedBudgetReason(state),
			state,
			false,
		);
	return unknown(
		RegionIncidentUnknownCode.NoValidAlternative,
		'No declared bounded alternative admits noncontacting local incident routes.',
		state,
		true,
	);
}

/** Incident resolution is reserved for the assembled final rank candidate, not local trials. */
function admitIncidentLayout(
	contracts: readonly RegionIncidentContract[],
	accepted: { attempt?: DedicatedRegionLeafIncidentSelected },
): (layout: LayoutResult, ranks: TopologicalRanks) => boolean {
	return (layout, ranks) => {
		const attempt = solveOnLayout(contracts, layout, ranks);
		if (attempt.status !== RegionCompositionStatus.Selected) return false;
		accepted.attempt = attempt;
		return true;
	};
}

class UncacheableIncidentFailure extends Error {
	constructor(readonly attempt: DedicatedRegionLeafIncidentUnknown) {
		super(attempt.reason);
	}
}

/** The dedicated leaf policy solves all declared incidents before the region is composed. */
export function solveDedicatedRegionLeafWithIncidents(
	input: DedicatedRegionLeafIncidentInput,
): DedicatedRegionLeafIncidentAttempt {
	const policyFailure = regionLeafPolicyFailure(LayoutPolicy.Layered, input.document);
	if (policyFailure !== undefined)
		return unknown(
			RegionIncidentUnknownCode.UnsupportedLeafPolicy,
			policyFailure,
			newSearchState(),
			true,
		);
	const endpointPositions = input.endpointPositions;
	let contracts: readonly RegionIncidentContract[];
	try {
		contracts = normalizeRegionIncidentContracts(input.contracts, endpointPositions);
	} catch (error) {
		let reason = String(error);
		if (error instanceof Error) reason = error.message;
		return unknown(RegionIncidentUnknownCode.InvalidContract, reason, newSearchState(), true);
	}
	const compute = () => {
		const endpointIds = new Set([
			...input.document.nodes.map(({ id }) => id),
			...input.document.groups.map(({ id }) => id),
			...input.document.junctions.map(({ id }) => id),
		]);
		const demands = incidentMetricDemands(contracts, endpointPositions).filter(({ endpointId }) =>
			endpointIds.has(endpointId),
		);
		const demanded = satisfyMetricDemands(
			input.measurements,
			demands,
			input.document.layout.direction,
		);
		const accepted: { attempt?: DedicatedRegionLeafIncidentSelected } = {};
		let admitDedicatedLayout:
			((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
		if (contracts.length > 0) admitDedicatedLayout = admitIncidentLayout(contracts, accepted);
		const raw = solveRegionLeafLayout({
			document: input.document,
			measurements: demanded,
			leafPolicy: LayoutPolicy.Layered,
			admitDedicatedLayout,
		});
		let attempt: DedicatedRegionLeafIncidentAttempt;
		if (accepted.attempt?.layout === raw.layout) attempt = accepted.attempt;
		else attempt = solveOnLayout(contracts, raw.layout, raw.ranks);
		if (attempt.status === RegionCompositionStatus.Unknown)
			throw new UncacheableIncidentFailure(attempt);
		return {
			layout: attempt.layout,
			ranks: attempt.ranks,
			incidents: attempt.incidents,
			witness: attempt.witness,
		};
	};
	try {
		let solved: RegionLocalLayout;
		if (input.cache === undefined) solved = compute();
		else
			solved = input.cache.getOrComputeContract({
				document: input.document,
				measurements: input.measurements,
				policy: LayoutPolicy.Layered,
				contracts,
				endpointPositions,
				compute,
			});
		// Every writer of a `RegionLocalLayout` in this cache defines both fields: this solver's own
		// `compute`, `region-leaf-layout`'s lane compute, and `region-leaf-base-layout`'s compute all
		// set `incidents` and `witness`, and the cache key carries the policy and normalized
		// contracts, so a hit at this key always carries the incident solution.
		const incidents = defined(solved.incidents);
		const selectedWitness = defined(solved.witness);
		return {
			status: RegionCompositionStatus.Selected,
			layout: solved.layout,
			ranks: solved.ranks,
			incidents,
			witness: selectedWitness,
		};
	} catch (error) {
		if (error instanceof UncacheableIncidentFailure) return error.attempt;
		throw error;
	}
}

/**
 * Candidate stream for composition. The first pull uses exactly the cached production selection;
 * only a subsequent pull explores other route assignments on that selected rank layout.
 * The return value is the final bounded-search witness (including rejected route provenance).
 */
export function* enumerateDedicatedRegionLeafWithIncidents(
	input: DedicatedRegionLeafIncidentInput,
): Generator<DedicatedRegionLeafIncidentSelected, RegionIncidentSearchWitness, void> {
	const first = solveDedicatedRegionLeafWithIncidents(input);
	if (first.status !== RegionCompositionStatus.Selected) return first.witness;
	yield first;
	const contracts = normalizeRegionIncidentContracts(input.contracts, input.endpointPositions);
	const elements = new Map(first.layout.elements.map((element) => [element.id, element]));
	const endpoints = contracts.map((contract) => defined(elements.get(contract.endpointId)));
	const state = newSearchState();
	let skippedFirst = false;
	for (const incidents of routesOnLayout(contracts, first.layout, endpoints, state)) {
		if (!skippedFirst) {
			skippedFirst = true;
			continue;
		}
		yield { ...first, incidents, witness: witness(state, false) };
	}
	return witness(state, !state.budgetExceeded && !state.incomplete);
}
