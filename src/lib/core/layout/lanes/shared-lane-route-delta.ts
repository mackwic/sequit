import type { LogicGraph } from '../../graph/create-graph';
import type { RouteWorkCharge } from '../bridges/bridge-oracle';
import { SHARED_LANE_CLEARANCE } from './shared-lane-frame';
import type { SharedLaneGeometry, SharedLaneGeometryCertificate } from './shared-lane-geometry';
import {
	validateSharedLaneGeometry,
	validateSharedLaneStaticGeometryWithCertificate,
} from './shared-lane-geometry';
import type { SharedLaneInput } from './shared-lane-model';
import {
	materializeParallelGeometry,
	type ParallelRouteCandidate,
} from './shared-lane-route-candidates';
import { validateSharedLaneRouteContacts } from './shared-lane-route-contact-validation';
import {
	validateChangedSharedLaneRoutes,
	validateSharedLaneRouteShapes,
} from './shared-lane-route-validation';
import { routeRailTrack, routeSharedLane } from './shared-lane-routing';

export interface ParallelRouteGeometryDelta {
	readonly geometry: SharedLaneGeometry;
	readonly changedRouteIds: ReadonlySet<string>;
}

/** Shape validity of the historical allocation in the same immutable frame. */
export interface SharedLaneRouteCertificate {
	readonly geometry: SharedLaneGeometry;
	readonly issue: string | undefined;
}

interface SharedLaneGeometryDeltaValidationInput {
	readonly graph: LogicGraph;
	readonly geometry: SharedLaneGeometry;
	readonly staticCertificate: SharedLaneGeometryCertificate;
	readonly routeCertificate: SharedLaneRouteCertificate;
	readonly changedRouteIds: ReadonlySet<string>;
	readonly acceptBridges: boolean;
	readonly clearance?: number;
	readonly charge?: RouteWorkCharge | undefined;
	readonly onBridgeCount?: (count: number) => void;
}

export function materializeParallelGeometryDelta(
	input: SharedLaneInput,
	candidate: ParallelRouteCandidate,
	baseline: ParallelRouteCandidate,
	baselineGeometry: SharedLaneGeometry,
): ParallelRouteGeometryDelta {
	if (candidate.frame !== baseline.frame || candidate.order !== baseline.order) {
		return {
			geometry: materializeParallelGeometry(
				input,
				candidate.frame,
				candidate.order,
				candidate.allocation,
			),
			changedRouteIds: new Set(input.plans.map(({ id }) => id)),
		};
	}
	const changedRouteIds = new Set<string>();
	for (const plan of input.plans) {
		const gutterChanged =
			candidate.allocation.gutter.trackByRelationId.get(plan.id) !==
			baseline.allocation.gutter.trackByRelationId.get(plan.id);
		const railChanged =
			routeRailTrack(candidate.frame, candidate.allocation, plan, candidate.order) !==
			routeRailTrack(baseline.frame, baseline.allocation, plan, baseline.order);
		const passageChanged =
			candidate.allocation.passage?.track !== baseline.allocation.passage?.track;
		if (gutterChanged) {
			changedRouteIds.add(plan.id);
		} else if (railChanged || passageChanged) changedRouteIds.add(plan.id);
	}
	if (changedRouteIds.size === 0) return { geometry: baselineGeometry, changedRouteIds };
	const changedRoutes = new Map<string, SharedLaneGeometry['relations'][number]>();
	for (const plan of input.plans) {
		if (!changedRouteIds.has(plan.id)) continue;
		changedRoutes.set(
			plan.id,
			routeSharedLane({
				input,
				frame: candidate.frame,
				allocation: candidate.allocation,
				order: candidate.order,
				plan,
			}),
		);
	}
	const relations = baselineGeometry.relations.map((route) => changedRoutes.get(route.id) ?? route);
	return {
		geometry: { ...baselineGeometry, relations },
		changedRouteIds,
	};
}

export function certifySharedLaneRouteGeometry(
	graph: LogicGraph,
	geometry: SharedLaneGeometry,
	clearance = SHARED_LANE_CLEARANCE,
): SharedLaneRouteCertificate {
	return { geometry, issue: validateSharedLaneRouteShapes(graph, geometry, clearance) };
}

export function validateSharedLaneGeometryDelta({
	graph,
	geometry,
	staticCertificate,
	routeCertificate,
	changedRouteIds,
	acceptBridges,
	charge,
	onBridgeCount,
	clearance = SHARED_LANE_CLEARANCE,
}: SharedLaneGeometryDeltaValidationInput): string | undefined {
	const staticIssue = validateSharedLaneStaticGeometryWithCertificate(
		graph,
		geometry,
		staticCertificate,
	);
	if (staticIssue !== undefined) return staticIssue;
	// A malformed historical route or a different frame cannot certify unchanged routes.
	const sameFrame =
		routeCertificate.geometry.lanes === geometry.lanes &&
		routeCertificate.geometry.elements === geometry.elements;
	if (!sameFrame) return validateSharedLaneGeometry(graph, geometry, clearance, acceptBridges);
	let routeIssue: string | undefined;
	if (routeCertificate.issue !== undefined)
		routeIssue = validateSharedLaneRouteShapes(graph, geometry, clearance, charge);
	else routeIssue = validateChangedSharedLaneRoutes(geometry, clearance, changedRouteIds, charge);
	if (routeIssue !== undefined) return routeIssue;
	return validateSharedLaneRouteContacts(geometry.relations, acceptBridges, charge, onBridgeCount);
}
