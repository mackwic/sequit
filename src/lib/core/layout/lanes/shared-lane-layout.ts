import { defined, LaneOrientation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { RouteWorkCharge } from '../bridges/route-runs';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from '../layout-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from '../regions/model/region-incident-contract';
import type { SharedLaneFrame } from './shared-lane-frame';
import {
	certifySharedLaneGeometry,
	type SharedLaneGeometry,
	type SharedLaneGeometryCertificate,
} from './shared-lane-geometry';
import { attemptSharedLaneGeometry } from './shared-lane-geometry-attempt';
import {
	completedIncidentWitness,
	emptyWitness,
	type IncidentSearchState,
	searchWitness,
	unknownCode,
} from './shared-lane-incident-search';
import {
	transverseGeometry,
	validatedInteriorParallelGeometry,
} from './shared-lane-layout-geometry';
import { prepareSharedLanes, type SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import {
	materializeParallelGeometry,
	type ParallelRouteCandidate,
	type SharedLaneAllocationSearchWitness,
} from './shared-lane-route-candidates';
import type { SharedLaneRouteCertificate } from './shared-lane-route-delta';
import {
	certifySharedLaneRouteGeometry,
	materializeParallelGeometryDelta,
} from './shared-lane-route-delta';
import { type RankedLaneRouteSelection, rankLaneRouteSelection } from './shared-lane-route-ranking';
import {
	laneSelectionCollector,
	searchParallelRouteAllocations,
	searchTransverseRouteOrders,
} from './shared-lane-route-search';
import type { TransverseRouteOrder } from './shared-transverse-routing';

export enum SharedLaneLayoutStatus {
	Selected = 'selected',
	Unknown = 'unknown',
	Unsupported = 'unsupported',
}

export interface SelectedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Selected;
	readonly layout: LayoutResult;
	readonly geometry: SharedLaneGeometry;
	readonly incidents: readonly RegionSolvedIncident[];
	readonly witness: RegionIncidentSearchWitness;
	readonly allocationWitness?: SharedLaneAllocationSearchWitness;
}

interface UnknownSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unknown;
	readonly reason: string;
	readonly code: RegionIncidentUnknownCode;
	readonly witness: RegionIncidentSearchWitness;
	readonly allocationWitness?: SharedLaneAllocationSearchWitness;
}

interface UnsupportedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unsupported;
	readonly reason: string;
}

export type SharedLaneLayoutOutcome =
	SelectedSharedLaneLayout | UnknownSharedLaneLayout | UnsupportedSharedLaneLayout;
export type SharedLaneAttempt = SelectedSharedLaneLayout | UnknownSharedLaneLayout;

export interface SharedLaneSolveOptions extends LayoutOptions {
	readonly incidents?: readonly RegionIncidentContract[];
}

export function selectedLayout(
	geometry: SharedLaneGeometry,
	incidents: readonly RegionSolvedIncident[],
	witness: RegionIncidentSearchWitness,
	allocationWitness?: SharedLaneAllocationSearchWitness,
): SelectedSharedLaneLayout {
	const selected: SelectedSharedLaneLayout = {
		status: SharedLaneLayoutStatus.Selected,
		layout: {
			width: geometry.width,
			height: geometry.height,
			lanes: geometry.lanes,
			elements: geometry.elements,
			relations: geometry.relations,
		},
		geometry,
		incidents,
		witness,
	};
	if (allocationWitness !== undefined) return { ...selected, allocationWitness };
	return selected;
}

export interface LaneAttemptInput {
	readonly graph: LogicGraph;
	readonly input: SharedLaneInput;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly collect?:
		| ((
				selection: RankedLaneRouteSelection<LaneCandidate>,
				witness: RegionIncidentSearchWitness,
		  ) => void)
		| undefined;
	readonly onAllocationReject?:
		((strategyId: string, candidateId: string, reason: string) => void) | undefined;
}

export interface LaneCandidate {
	readonly geometry: SharedLaneGeometry;
	readonly incidents: readonly RegionSolvedIncident[];
	readonly bridges?: number | undefined;
}
export function parallelAttempt({
	graph,
	input,
	ports,
	contracts,
	collect,
	onAllocationReject,
}: LaneAttemptInput): SharedLaneAttempt {
	let firstIssue: string | undefined;
	const state: IncidentSearchState = {
		attempted: 0,
		exhaustive: true,
		strategyId: '',
		candidateId: '',
		rejectedAlternatives: [],
	};
	let interior: SharedLaneGeometry | string | undefined;
	if (contracts.length === 0) interior = validatedInteriorParallelGeometry(graph, input, ports);
	if (typeof interior === 'string') {
		firstIssue = interior;
		onAllocationReject?.('interior', 'interior', interior);
	} else if (interior !== undefined) {
		if (collect === undefined) return selectedLayout(interior, [], emptyWitness());
		collect(
			rankLaneRouteSelection(
				{ geometry: interior, incidents: [] },
				{
					historicalRank: -1,
					allocationKey: '[]',
					strategyId: 'interior',
					candidateId: 'interior',
				},
			),
			emptyWitness(),
		);
	}
	const certificatesByFrame = new WeakMap<
		SharedLaneFrame,
		{
			readonly candidate: ParallelRouteCandidate;
			readonly geometry: SharedLaneGeometry;
			readonly staticCertificate: SharedLaneGeometryCertificate;
			readonly routeCertificate: SharedLaneRouteCertificate;
		}
	>();
	const search = searchParallelRouteAllocations({
		input,
		ports,
		contracts,
		state,
		collect: laneSelectionCollector(state, collect),
		evaluate: (candidate, acceptBridges, charge: RouteWorkCharge) => {
			let base = certificatesByFrame.get(candidate.frame);
			if (base === undefined) {
				const geometry = materializeParallelGeometry(
					input,
					candidate.frame,
					candidate.order,
					candidate.allocation,
				);
				base = {
					candidate,
					geometry,
					staticCertificate: certifySharedLaneGeometry(graph, geometry),
					routeCertificate: certifySharedLaneRouteGeometry(graph, geometry),
				};
				certificatesByFrame.set(candidate.frame, base);
			}
			charge(input.plans.length);
			const { geometry, changedRouteIds } = materializeParallelGeometryDelta(
				input,
				candidate,
				base.candidate,
				base.geometry,
			);
			const attempt = attemptSharedLaneGeometry({
				graph,
				geometry,
				ports,
				contracts,
				acceptBridges,
				state,
				certificate: base.staticCertificate,
				routeCertificate: base.routeCertificate,
				changedRouteIds,
				charge,
			});
			if (typeof attempt === 'string') {
				firstIssue ??= attempt;
				onAllocationReject?.(candidate.strategyId, candidate.candidateId, attempt);
				return undefined;
			}
			return { geometry, incidents: attempt.incidents, bridges: attempt.bridges };
		},
	});
	if (search.selected !== undefined)
		return selectedLayout(
			search.selected.geometry,
			search.selected.incidents,
			completedIncidentWitness(state, contracts),
			search.allocationWitness,
		);
	let code = unknownCode(state);
	if (search.allocationTruncated) code = RegionIncidentUnknownCode.SearchBudgetExceeded;
	return {
		status: SharedLaneLayoutStatus.Unknown,
		code,
		reason: defined(firstIssue),
		witness: searchWitness(state),
		allocationWitness: search.allocationWitness,
	};
}

export function transverseAttempt({
	graph,
	input,
	ports,
	contracts,
	collect,
	onAllocationReject,
}: LaneAttemptInput): SharedLaneAttempt {
	let firstIssue: string | undefined;
	const state: IncidentSearchState = {
		attempted: 0,
		exhaustive: true,
		strategyId: '',
		candidateId: '',
		rejectedAlternatives: [],
	};
	const preparedByOrder = new Map<
		TransverseRouteOrder,
		{ readonly geometry: SharedLaneGeometry; readonly certificate: SharedLaneGeometryCertificate }
	>();
	const search = searchTransverseRouteOrders({
		collect: laneSelectionCollector(state, collect),
		evaluate: (strategy) => {
			state.strategyId = strategy.id;
			state.candidateId = strategy.id;
			let prepared = preparedByOrder.get(strategy.order);
			if (prepared === undefined) {
				const geometry = transverseGeometry(input, ports, strategy.order);
				prepared = { geometry, certificate: certifySharedLaneGeometry(graph, geometry) };
				preparedByOrder.set(strategy.order, prepared);
			}
			const selected = attemptSharedLaneGeometry({
				graph,
				geometry: prepared.geometry,
				ports,
				contracts,
				acceptBridges: strategy.acceptBridges,
				state,
				certificate: prepared.certificate,
			});
			if (typeof selected === 'string') {
				firstIssue ??= selected;
				onAllocationReject?.(strategy.id, strategy.order, selected);
				return undefined;
			}
			return { geometry: prepared.geometry, incidents: selected.incidents };
		},
	});
	if (search.selected !== undefined)
		return selectedLayout(
			search.selected.geometry,
			search.selected.incidents,
			completedIncidentWitness(state, contracts),
			search.allocationWitness,
		);
	return {
		status: SharedLaneLayoutStatus.Unknown,
		code: unknownCode(state),
		reason: defined(firstIssue),
		witness: searchWitness(state),
		allocationWitness: search.allocationWitness,
	};
}

/** A bounded shared-root policy. Unsupported documents never fall back to the mono-lane engine. */
export function solveSharedLaneLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: SharedLaneSolveOptions = {},
): SharedLaneLayoutOutcome {
	let contracts: readonly RegionIncidentContract[];
	try {
		contracts = normalizeRegionIncidentContracts(options.incidents ?? []);
	} catch (error) {
		let reason = 'Invalid lane incident contract.';
		if (error instanceof Error) reason = error.message;
		return {
			status: SharedLaneLayoutStatus.Unknown,
			code: RegionIncidentUnknownCode.InvalidContract,
			reason,
			witness: emptyWitness(),
		};
	}
	const prepared = prepareSharedLanes(graph, ranks, measurements, options);
	const input = prepared.input;
	if (input === undefined)
		return { status: SharedLaneLayoutStatus.Unsupported, reason: defined(prepared.reason) };
	const ports = planSharedLanePorts(input, contracts);
	const attempt = { graph, input, ports, contracts };
	if (input.orientation === LaneOrientation.Parallel) return parallelAttempt(attempt);
	return transverseAttempt(attempt);
}
