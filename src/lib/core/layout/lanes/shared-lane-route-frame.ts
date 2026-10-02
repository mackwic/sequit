import { defined } from '../../document/logic-document';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import {
	makeSharedLaneFrame,
	SHARED_LANE_CLEARANCE,
	type SharedLaneFrame,
} from './shared-lane-frame';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import type { SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts } from './shared-lane-ports';
import { rejectedSharedLaneRouteContacts } from './shared-lane-route-contact-validation';
import { rejectedSharedLaneRouteShapes } from './shared-lane-route-validation';
import {
	allocateParallelRoutes,
	type ParallelRouteAllocation,
	ParallelRouteOrder,
	type ParallelRouteTrackOverrides,
	routeSharedLanes,
} from './shared-lane-routing';

export interface ParallelStrategyFrame {
	readonly frame: SharedLaneFrame;
	readonly allocation: ParallelRouteAllocation;
}

export interface ParallelLateralFaces {
	readonly source: string;
	readonly target: string;
}

export interface ParallelStrategyResources {
	readonly contracts: readonly RegionIncidentContract[];
	readonly lateralFaces: ReadonlyMap<string, ParallelLateralFaces>;
}

export interface ParallelFramePlan extends ParallelStrategyFrame, ParallelStrategyResources {
	readonly order: ParallelRouteOrder;
	/** Local alternatives share their immutable frame and passage map across track products. */
	readonly localFrames: Map<string, ParallelStrategyFrame>;
}

export function materializeParallelGeometry(
	input: SharedLaneInput,
	frame: SharedLaneFrame,
	order: ParallelRouteOrder,
	allocation: ParallelRouteAllocation,
): SharedLaneGeometry {
	let width = frame.longExtent;
	let height = frame.crossExtent;
	if (input.vertical) {
		width = frame.crossExtent;
		height = frame.longExtent;
	}
	return {
		width,
		height,
		lanes: frame.lanes,
		elements: frame.elements,
		relations: routeSharedLanes(input, frame, allocation, order),
	};
}

function localStrategyFrame(
	input: SharedLaneInput,
	plan: ParallelFramePlan,
	rejected: ReadonlySet<string>,
): ParallelStrategyFrame {
	let key = '';
	for (const { id } of input.plans) key += Number(rejected.has(id)).toString();
	const cached = plan.localFrames.get(key);
	if (cached !== undefined) return cached;
	const localInput = {
		...input,
		plans: input.plans.map((route) => ({
			...route,
			mainFaces: route.mainFaces && !rejected.has(route.id),
		})),
	};
	const ports = planSharedLanePorts(localInput, plan.contracts);
	const frame = makeSharedLaneFrame(localInput, ports, plan.order !== ParallelRouteOrder.Canonical);
	const alternative = { frame, allocation: allocateParallelRoutes(localInput, frame) };
	plan.localFrames.set(key, alternative);
	return alternative;
}

/** Main-face placement also changes the lateral ports on the incidence's former face. */
function contactCoupledPlans(
	plan: ParallelFramePlan,
	frame: SharedLaneFrame,
	contacts: ReadonlySet<string>,
): ReadonlySet<string> {
	const faces = new Set<string>();
	for (const id of contacts) {
		const keys = defined(plan.lateralFaces.get(id));
		faces.add(keys.source);
		faces.add(keys.target);
	}
	const coupled = new Set<string>();
	for (const id of frame.mainFacePlanIds) {
		const keys = defined(plan.lateralFaces.get(id));
		if (faces.has(keys.source) || faces.has(keys.target)) coupled.add(id);
	}
	return coupled;
}

export function resolveParallelCandidateFrame(
	input: SharedLaneInput,
	plan: ParallelFramePlan,
	acceptBridges: boolean,
	overrides: ParallelRouteTrackOverrides | undefined,
): ParallelStrategyFrame {
	const rejected = new Set<string>();
	let selected = defined(plan.localFrames.get(''));
	// Each unsuccessful iteration rejects at least one still-main relation.
	for (let remaining = selected.frame.mainFacePlanIds.size + 1; remaining > 0; remaining -= 1) {
		let allocation = selected.allocation;
		if (overrides !== undefined)
			allocation = allocateParallelRoutes(input, selected.frame, {
				...overrides,
				mainTrackByPlan: selected.allocation.mainTrackByPlan,
			});
		const frame = selected.frame;
		if (frame.mainFacePlanIds.size === 0) return { frame, allocation };
		const geometry = materializeParallelGeometry(input, frame, plan.order, allocation);
		const shapes = rejectedSharedLaneRouteShapes(
			geometry,
			frame.mainFacePlanIds,
			SHARED_LANE_CLEARANCE,
		);
		const contacts = rejectedSharedLaneRouteContacts(geometry.relations, acceptBridges);
		if (shapes.size === 0 && contacts.size === 0) return { frame, allocation };
		const previousCount = rejected.size;
		for (const id of shapes) rejected.add(id);
		for (const id of contactCoupledPlans(plan, frame, contacts)) rejected.add(id);
		if (rejected.size === previousCount) return { frame, allocation };
		selected = localStrategyFrame(input, plan, rejected);
	}
	throw new Error('Main-face fallback did not converge.');
}
