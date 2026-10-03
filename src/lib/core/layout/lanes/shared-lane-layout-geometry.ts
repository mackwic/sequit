import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import { makeSharedLaneFrame } from './shared-lane-frame';
import type { SharedLaneGeometry, SharedLaneGeometryCertificate } from './shared-lane-geometry';
import { interiorPassageAllocation } from './shared-lane-interior-passage';
import { validateSharedLaneInteriorPassage } from './shared-lane-interior-validation';
import type { SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import { allocateParallelRoutes, routeSharedLanes } from './shared-lane-routing';
import { makeTransverseLaneFrame } from './shared-transverse-frame';
import { withLocalArcs } from './shared-transverse-legs';
import {
	allocateTransverseRoutes,
	routeTransverseLanes,
	TransverseRouteOrder,
} from './shared-transverse-routing';

function geometryDimensions(
	input: SharedLaneInput,
	crossExtent: number,
	longExtent: number,
): { readonly width: number; readonly height: number } {
	if (input.vertical) return { width: crossExtent, height: longExtent };
	return { width: longExtent, height: crossExtent };
}

export function validatedInteriorParallelGeometry(
	graph: LogicGraph,
	input: SharedLaneInput,
	ports: SharedLanePorts,
): SharedLaneGeometry | string | undefined {
	const frame = makeSharedLaneFrame(input, ports);
	const passage = interiorPassageAllocation(input, frame, ports);
	if (passage === undefined) return undefined;
	const dimensions = geometryDimensions(input, frame.crossExtent, frame.longExtent);
	const geometry: SharedLaneGeometry = {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, {
			...allocateParallelRoutes(frame),
			passage,
		}),
	};
	const relationId = defined(input.plans[0]).id;
	const issue = validateSharedLaneInteriorPassage(graph, geometry, relationId);
	if (issue !== undefined) return issue;
	return geometry;
}

/** One transverse candidate geometry and the ports it was placed and routed with. */
export interface TransverseVariant {
	readonly geometry: SharedLaneGeometry;
	readonly ports: SharedLanePorts;
}

/** A transverse variant with the static certificate its incident searches reuse. */
export interface PreparedTransverseVariant extends TransverseVariant {
	readonly certificate: SharedLaneGeometryCertificate;
}

/**
 * The geometry of one transverse order. The gutter orders keep the historical local U arcs, which
 * leave and enter one face; the direct orders join the facing faces of two rows of one lane. Each
 * side choice places its own ports, so a refused or bridged facing leg falls back to the arcs.
 */
export function transverseGeometry(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	order: TransverseRouteOrder,
	contracts: readonly RegionIncidentContract[],
): TransverseVariant {
	let lanes = input;
	let placed = ports;
	if (order === TransverseRouteOrder.Canonical || order === TransverseRouteOrder.Nested) {
		lanes = withLocalArcs(input);
		if (lanes !== input) placed = planSharedLanePorts(lanes, contracts);
	}
	const frame = makeTransverseLaneFrame(lanes, placed);
	const dimensions = geometryDimensions(lanes, frame.crossExtent, frame.longExtent);
	const geometry = {
		...dimensions,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeTransverseLanes(
			lanes,
			frame,
			allocateTransverseRoutes(lanes, frame, order),
			order,
		),
	};
	return { geometry, ports: placed };
}
