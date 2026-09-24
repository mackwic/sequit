import { defined, LaneOrientation } from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { TopologicalRanks } from '../graph/topological-ranks';
import type { LayoutMeasurements, LayoutOptions, LayoutResult } from './layout-types';
import { makeSharedLaneFrame, SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import { type SharedLaneGeometry, validateSharedLaneGeometry } from './shared-lane-geometry';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';
import { validateSharedLaneOutgoingIncident } from './shared-lane-incident-validation';
import { interiorPassageTrack } from './shared-lane-interior-passage';
import { validateSharedLaneInteriorPassage } from './shared-lane-interior-validation';
import { prepareSharedLanes, type SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import {
	ParallelRouteOrder,
	routeSharedLanes,
	routeSharedLaneThroughInterior,
} from './shared-lane-routing';
import { makeTransverseLaneFrame } from './shared-transverse-frame';
import { routeTransverseLanes, TransverseRouteOrder } from './shared-transverse-routing';

export enum SharedLaneLayoutStatus {
	Selected = 'selected',
	Unknown = 'unknown',
	Unsupported = 'unsupported',
}

interface SelectedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Selected;
	readonly layout: LayoutResult;
	readonly geometry: SharedLaneGeometry;
}

interface UnknownSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unknown;
	readonly reason: string;
}

interface UnsupportedSharedLaneLayout {
	readonly status: SharedLaneLayoutStatus.Unsupported;
	readonly reason: string;
}

export type SharedLaneLayoutOutcome =
	SelectedSharedLaneLayout | UnknownSharedLaneLayout | UnsupportedSharedLaneLayout;

export interface SharedLaneSolveOptions extends LayoutOptions {
	readonly outgoingIncident?: SharedLaneOutgoingIncident;
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
		relations: routeSharedLanes(input, frame, ports, order),
	};
}

function interiorParallelGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
): SharedLaneGeometry | undefined {
	const frame = makeSharedLaneFrame(input, ports);
	const track = interiorPassageTrack(input, frame, ports);
	if (track === undefined) return undefined;
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	return {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLaneThroughInterior(input, frame, ports, track),
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
		relations: routeTransverseLanes(input, frame, ports, order),
	};
}

function selectedLayout(geometry: SharedLaneGeometry): SelectedSharedLaneLayout {
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
	};
}

function incidentPolicyFailure(
	input: SharedLaneInput,
	incident: SharedLaneOutgoingIncident,
): string | undefined {
	const verticalParallel = input.orientation === LaneOrientation.Parallel && input.vertical;
	if (!verticalParallel || input.reverse)
		return 'A right-facing lane incident requires top-to-bottom parallel lanes.';
	if (!input.endpoints.has(incident.endpointId))
		return `Incident ${incident.relationId} has no local source endpoint.`;
	return undefined;
}

function parallelOrders(incident?: SharedLaneOutgoingIncident): readonly ParallelRouteOrder[] {
	if (incident === undefined)
		return [ParallelRouteOrder.Canonical, ParallelRouteOrder.LocalPassages];
	return [
		ParallelRouteOrder.ReservedTopPassage,
		ParallelRouteOrder.Canonical,
		ParallelRouteOrder.LocalPassages,
	];
}

function parallelAttempt(
	graph: LogicGraph,
	input: SharedLaneInput,
	ports: SharedLanePorts,
	incident?: SharedLaneOutgoingIncident,
): SharedLaneLayoutOutcome {
	let firstIssue: string | undefined;
	if (incident === undefined) {
		const interior = interiorParallelGeometry(input, ports);
		if (interior !== undefined) {
			const relationId = defined(input.plans[0]).id;
			const issue = validateSharedLaneInteriorPassage(graph, interior, relationId);
			if (issue === undefined) return selectedLayout(interior);
			firstIssue = issue;
		}
	}
	for (const order of parallelOrders(incident)) {
		const geometry = parallelGeometry(input, ports, order);
		let issue = validateSharedLaneGeometry(graph, geometry, SHARED_LANE_CLEARANCE);
		if (issue === undefined && incident !== undefined)
			issue = validateSharedLaneOutgoingIncident(geometry, incident);
		if (issue === undefined) return selectedLayout(geometry);
		firstIssue ??= issue;
	}
	return { status: SharedLaneLayoutStatus.Unknown, reason: defined(firstIssue) };
}

function transverseAttempt(
	graph: LogicGraph,
	input: SharedLaneInput,
	ports: SharedLanePorts,
): SharedLaneLayoutOutcome {
	let firstIssue: string | undefined;
	for (const order of [TransverseRouteOrder.Canonical, TransverseRouteOrder.Nested]) {
		const geometry = transverseGeometry(input, ports, order);
		const issue = validateSharedLaneGeometry(graph, geometry, SHARED_LANE_CLEARANCE);
		if (issue === undefined) return selectedLayout(geometry);
		firstIssue ??= issue;
	}
	return { status: SharedLaneLayoutStatus.Unknown, reason: defined(firstIssue) };
}

/** A bounded shared-root policy. Unsupported documents never fall back to the mono-lane engine. */
export function solveSharedLaneLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: SharedLaneSolveOptions = {},
): SharedLaneLayoutOutcome {
	const prepared = prepareSharedLanes(graph, ranks, measurements, options);
	const input = prepared.input;
	if (input === undefined)
		return { status: SharedLaneLayoutStatus.Unsupported, reason: defined(prepared.reason) };
	const incident = options.outgoingIncident;
	if (incident !== undefined) {
		const failure = incidentPolicyFailure(input, incident);
		if (failure !== undefined)
			return { status: SharedLaneLayoutStatus.Unsupported, reason: failure };
	}
	const ports = planSharedLanePorts(input, incident);
	if (input.orientation === LaneOrientation.Parallel)
		return parallelAttempt(graph, input, ports, incident);
	return transverseAttempt(graph, input, ports);
}
