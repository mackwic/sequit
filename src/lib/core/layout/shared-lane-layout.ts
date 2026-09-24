import { defined, LaneOrientation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import {
	normalizeRegionIncidentContracts,
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from './region-incident-contract';
import { makeSharedLaneFrame, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import { type SharedLaneGeometry, validateSharedLaneGeometry } from './shared-lane-geometry';
import {
	type IncidentSearchState,
	rejectIncidentAlternative,
	searchLaneIncidentPaths,
	searchWitness,
	unknownCode,
} from './shared-lane-incident-search';
import { interiorPassageAllocation } from './shared-lane-interior-passage';
import { validateSharedLaneInteriorPassage } from './shared-lane-interior-validation';
import { prepareSharedLanes, type SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import { twoPassStrategies } from './shared-lane-route-strategies';
import {
	allocateParallelRoutes,
	ParallelRouteOrder,
	routeSharedLanes,
} from './shared-lane-routing';
import { makeTransverseLaneFrame } from './shared-transverse-frame';
import {
	allocateTransverseRoutes,
	routeTransverseLanes,
	TransverseRouteOrder,
} from './shared-transverse-routing';

export enum SharedLaneLayoutStatus {
	Selected = 'selected',
	Unknown = 'unknown',
	Unsupported = 'unsupported',
}

interface SelectedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Selected;
	readonly layout: LayoutResult;
	readonly geometry: SharedLaneGeometry;
	readonly incidents: readonly RegionSolvedIncident[];
	readonly witness: RegionIncidentSearchWitness;
}

interface UnknownSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unknown;
	readonly reason: string;
	readonly code: RegionIncidentUnknownCode;
	readonly witness: RegionIncidentSearchWitness;
}

interface UnsupportedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unsupported;
	readonly reason: string;
}

export type SharedLaneLayoutOutcome =
	SelectedSharedLaneLayout | UnknownSharedLaneLayout | UnsupportedSharedLaneLayout;

export interface SharedLaneSolveOptions extends LayoutOptions {
	readonly incidents?: readonly RegionIncidentContract[];
	/**
	 * Whether the solver's second pass may accept a contact carried by a validated bridge. Root
	 * shared lanes adopt it; a region leaf keeps it forbidden until leaf bridge support lands, so
	 * every leaf lane layout stays exactly as before.
	 */
	readonly acceptBridges?: boolean;
}

function geometryDimensions(
	input: SharedLaneInput,
	crossExtent: number,
	longExtent: number,
): {
	readonly width: number;
	readonly height: number;
} {
	if (input.vertical) return { width: crossExtent, height: longExtent };
	return { width: longExtent, height: crossExtent };
}

function parallelGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	order: ParallelRouteOrder,
): SharedLaneGeometry {
	const reserveTop = order !== ParallelRouteOrder.Canonical;
	const frame = makeSharedLaneFrame(input, ports, reserveTop);
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, allocateParallelRoutes(input, frame), order),
	};
}

function interiorParallelGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): SharedLaneGeometry | undefined {
	const frame = makeSharedLaneFrame(input, ports);
	const passage = interiorPassageAllocation(input, frame, ports);
	if (passage === undefined) return undefined;
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, {
			...allocateParallelRoutes(input, frame),
			passage,
		}),
	};
}

function transverseGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	order: TransverseRouteOrder,
): SharedLaneGeometry {
	const frame = makeTransverseLaneFrame(input, ports);
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeTransverseLanes(
			input,
			frame,
			allocateTransverseRoutes(input, frame, order),
			order,
		),
	};
}

function selectedLayout(
	geometry: SharedLaneGeometry,
	incidents: readonly RegionSolvedIncident[],
	witness: RegionIncidentSearchWitness,
): SelectedSharedLaneLayout {
	return {
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
}

function emptyWitness(): RegionIncidentSearchWitness {
	return { attempted: 0, exhaustive: true, rejectedAlternatives: [] };
}

function parallelOrders(
	contracts: readonly RegionIncidentContract[],
): readonly ParallelRouteOrder[] {
	if (contracts.length === 0)
		return [ParallelRouteOrder.Canonical, ParallelRouteOrder.LocalPassages];
	return [
		ParallelRouteOrder.ReservedTopPassage,
		ParallelRouteOrder.Canonical,
		ParallelRouteOrder.LocalPassages,
	];
}

interface GeometryAttemptInput {
	readonly graph: LogicGraph;
	readonly geometry: SharedLaneGeometry;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly acceptBridges: boolean;
	readonly state: IncidentSearchState;
}

function geometryAttempt(input: GeometryAttemptInput): SelectedSharedLaneLayout | string {
	const { graph, geometry, ports, contracts, acceptBridges, state } = input;
	const issue = validateSharedLaneGeometry(graph, geometry, SHARED_LANE_CLEARANCE, acceptBridges);
	if (issue !== undefined) {
		const first = contracts[0];
		const side = first?.allowedSides[0];
		if (first !== undefined && side !== undefined) {
			state.attempted += 1;
			rejectIncidentAlternative(state, first, side, {
				code: RegionIncidentRejectionCode.GeometryInvalid,
				reason: issue,
			});
		}
		return issue;
	}
	const incidents = searchLaneIncidentPaths({ geometry, ports, contracts, state });
	if (incidents === undefined)
		return state.rejectedAlternatives[0]?.reason ?? 'No lane incident side remains valid.';
	const witness = searchWitness(state);
	if (contracts.length > 0)
		return selectedLayout(geometry, incidents, { ...witness, exhaustive: false });
	return selectedLayout(geometry, incidents, witness);
}

interface LaneAttemptInput {
	readonly graph: LogicGraph;
	readonly input: SharedLaneInput;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly acceptBridges: boolean;
}

function parallelAttempt({
	graph,
	input,
	ports,
	contracts,
	acceptBridges,
}: LaneAttemptInput): SharedLaneLayoutOutcome {
	let firstIssue: string | undefined;
	const state: IncidentSearchState = {
		attempted: 0,
		exhaustive: true,
		strategyId: '',
		candidateId: '',
		rejectedAlternatives: [],
	};
	if (contracts.length === 0) {
		const interior = interiorParallelGeometry(input, ports);
		if (interior !== undefined) {
			const relationId = defined(input.plans[0]).id;
			const issue = validateSharedLaneInteriorPassage(graph, interior, relationId);
			if (issue === undefined) return selectedLayout(interior, [], emptyWitness());
			firstIssue = issue;
		}
	}
	for (const strategy of twoPassStrategies('parallel', parallelOrders(contracts), acceptBridges)) {
		state.strategyId = strategy.id;
		state.candidateId = strategy.id;
		const geometry = parallelGeometry(input, ports, strategy.order);
		const attempt = geometryAttempt({
			graph,
			geometry,
			ports,
			contracts,
			acceptBridges: strategy.acceptBridges,
			state,
		});
		if (typeof attempt !== 'string') return attempt;
		firstIssue ??= attempt;
		if (!state.exhaustive) break;
	}
	return {
		status: SharedLaneLayoutStatus.Unknown,
		code: unknownCode(state),
		reason: defined(firstIssue),
		witness: searchWitness(state),
	};
}

function transverseAttempt({
	graph,
	input,
	ports,
	contracts,
	acceptBridges,
}: LaneAttemptInput): SharedLaneLayoutOutcome {
	let firstIssue: string | undefined;
	const state: IncidentSearchState = {
		attempted: 0,
		exhaustive: true,
		strategyId: '',
		candidateId: '',
		rejectedAlternatives: [],
	};
	for (const strategy of twoPassStrategies(
		'transverse',
		[TransverseRouteOrder.Canonical, TransverseRouteOrder.Nested],
		acceptBridges,
	)) {
		state.strategyId = strategy.id;
		state.candidateId = strategy.id;
		const geometry = transverseGeometry(input, ports, strategy.order);
		const attempt = geometryAttempt({
			graph,
			geometry,
			ports,
			contracts,
			acceptBridges: strategy.acceptBridges,
			state,
		});
		if (typeof attempt !== 'string') return attempt;
		firstIssue ??= attempt;
		if (!state.exhaustive) break;
	}
	return {
		status: SharedLaneLayoutStatus.Unknown,
		code: unknownCode(state),
		reason: defined(firstIssue),
		witness: searchWitness(state),
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
	const acceptBridges = options.acceptBridges ?? true;
	const attempt = { graph, input, ports, contracts, acceptBridges };
	if (input.orientation === LaneOrientation.Parallel) return parallelAttempt(attempt);
	return transverseAttempt(attempt);
}
