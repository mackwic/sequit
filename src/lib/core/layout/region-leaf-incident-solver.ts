import { defined, LayoutPolicy, type LogicDocument } from '../document/logic-document';
import type { TopologicalRanks } from '../graph/topological-ranks';
import { firstValidDepthFirst } from './bounded-search';
import { satisfyMetricDemands } from './contract/metric-demand';
import type { LayoutMeasurements, LayoutResult } from './layout-types';
import { RegionCompositionStatus, type RegionPortalSide } from './region-composition-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from './region-incident-contract';
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
	newSearchState,
	recordRejection,
	type SearchState,
	takeAttempt,
	witness,
} from './region-leaf-incident-search-state';
import { regionLeafPolicyFailure } from './region-leaf-policy';
import type { RegionLocalLayout, RegionLocalLayoutCache } from './region-local-cache';

const MAX_INCIDENTS = 8;

export interface DedicatedRegionLeafIncidentInput {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly contracts: readonly RegionIncidentContract[];
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
	if (contracts.length > MAX_INCIDENTS)
		return unknown(
			RegionIncidentUnknownCode.SearchBudgetExceeded,
			`A dedicated leaf accepts at most ${MAX_INCIDENTS} incident contracts per bounded search.`,
			state,
			false,
		);
	const elements = new Map(layout.elements.map((element) => [element.id, element]));
	for (const contract of contracts) {
		if (elements.has(contract.endpointId)) continue;
		for (const side of contract.allowedSides) {
			takeAttempt(state);
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
	const sides: RegionPortalSide[] = [];

	function routeAt(
		slotSides: readonly RegionPortalSide[],
	): readonly RegionSolvedIncident[] | undefined {
		const slots = slotsForAssignment(contracts, slotSides);
		const found = firstValidDepthFirst<RegionSolvedIncident, RegionLeafIncidentGeometryFailure>({
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
				});
			},
		});
		return found.selected;
	}

	function assignSides(index: number): readonly RegionSolvedIncident[] | undefined {
		if (index === contracts.length) {
			// A hard side combination must not consume the search reserved for later
			// admitted sides. The witness remains incomplete if this cap is reached.
			state.assignmentAttempts = 0;
			state.assignmentLimitReached = false;
			return routeAt(sides);
		}
		const contract = defined(contracts[index]);
		for (const side of contract.allowedSides) {
			sides.push(side);
			const result = assignSides(index + 1);
			if (result !== undefined) return result;
			sides.pop();
			if (state.budgetExceeded) return undefined;
		}
		return undefined;
	}

	const incidents = assignSides(0);
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
			'The bounded dedicated-leaf incident search exhausted its alternative budget.',
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

/** Ignore inspection metadata, which completion may attach on a distinct result object. */
function incidentLayoutKey(layout: LayoutResult): string {
	return JSON.stringify([layout.width, layout.height, layout.elements, layout.relations]);
}

function admitIncidentLayout(
	contracts: readonly RegionIncidentContract[],
	accepted: Map<string, DedicatedRegionLeafIncidentSelected>,
): (layout: LayoutResult, ranks: TopologicalRanks) => boolean {
	return (layout, ranks) => {
		const attempt = solveOnLayout(contracts, layout, ranks);
		if (attempt.status !== RegionCompositionStatus.Selected) return false;
		accepted.set(incidentLayoutKey(layout), attempt);
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
	let contracts: readonly RegionIncidentContract[];
	try {
		contracts = normalizeRegionIncidentContracts(input.contracts);
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
		const demands = incidentMetricDemands(contracts).filter(({ endpointId }) =>
			endpointIds.has(endpointId),
		);
		const demanded = satisfyMetricDemands(
			input.measurements,
			demands,
			input.document.layout.direction,
		);
		const accepted = new Map<string, DedicatedRegionLeafIncidentSelected>();
		let admitDedicatedLayout:
			((layout: LayoutResult, ranks: TopologicalRanks) => boolean) | undefined;
		if (contracts.length > 0) admitDedicatedLayout = admitIncidentLayout(contracts, accepted);
		const raw = solveRegionLeafLayout({
			document: input.document,
			measurements: demanded,
			leafPolicy: LayoutPolicy.Layered,
			admitDedicatedLayout,
		});
		const attempt =
			accepted.get(incidentLayoutKey(raw.layout)) ??
			solveOnLayout(contracts, raw.layout, raw.ranks);
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
