import { defined } from '../../document/logic-document';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import {
	type TrackAllocationProduct,
	trackAllocationProductCount,
	trackAllocationProducts,
	type TrackAssignmentDomain,
} from './shared-lane-allocation-search';
import {
	makeSharedLaneFrame,
	SHARED_LANE_CLEARANCE,
	type SharedLaneFrame,
} from './shared-lane-frame';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import type { SharedLaneInput } from './shared-lane-model';
import { planSharedLanePorts, type SharedLanePorts } from './shared-lane-ports';
import { rejectedSharedLaneRouteContacts } from './shared-lane-route-contact-validation';
import { rejectedSharedLaneRouteShapes } from './shared-lane-route-validation';
import {
	allocateParallelRoutes,
	type ParallelRouteAllocation,
	ParallelRouteOrder,
	type ParallelRouteTrackOverrides,
	routeSharedLanes,
} from './shared-lane-routing';

interface SharedLaneAllocationPassWitness {
	readonly acceptBridges: boolean;
	readonly attempted: number;
	/** Exact decimal count, including products larger than Number.MAX_SAFE_INTEGER. */
	readonly total: string;
	readonly exhaustive: boolean;
	readonly truncated: boolean;
	readonly searchStarted: boolean;
	/** Measured candidate work, excluding separately reserved baselines. */
	readonly work: number;
	readonly baselineWork?: number;
	readonly workBudget: number;
}

export interface SharedLaneAllocationSearchWitness {
	readonly passes: readonly SharedLaneAllocationPassWitness[];
}

export interface ParallelRouteCandidate extends StrategyFrame, StrategyDefinition {
	readonly strategyId: string;
	readonly candidateId: string;
	readonly allocationKey: string;
	readonly historicalRank: number | undefined;
}

interface StrategyFrame {
	readonly frame: SharedLaneFrame;
	readonly allocation: ParallelRouteAllocation;
}

interface StrategyDefinition {
	readonly order: ParallelRouteOrder;
	readonly strategyRank: number;
}

interface LateralFaces {
	readonly source: string;
	readonly target: string;
}

interface StrategyResources {
	readonly contracts: readonly RegionIncidentContract[];
	readonly lateralFaces: ReadonlyMap<string, LateralFaces>;
}

interface ParallelStrategyPlan extends StrategyFrame, StrategyDefinition, StrategyResources {
	readonly domains: readonly TrackAssignmentDomain[];
	readonly baselineKey: string;
	readonly total: bigint;
	/** Local alternatives share their immutable frame and passage map across track products. */
	readonly localFrames: Map<string, StrategyFrame>;
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

function parallelFrame(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	order: ParallelRouteOrder,
): SharedLaneFrame {
	return makeSharedLaneFrame(input, ports, order !== ParallelRouteOrder.Canonical);
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

function activeRailKeys(frame: SharedLaneFrame, order: ParallelRouteOrder): readonly string[] {
	const ids: string[] = [];
	for (const plan of frame.crossLanePlans) {
		if (order === ParallelRouteOrder.LocalPassages) {
			const laneSpan = Math.abs(plan.sourceLaneIndex - plan.targetLaneIndex);
			if (laneSpan === 1) continue;
		}
		ids.push(plan.id);
	}
	return ids;
}

function strategyPlan(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	{ contracts, lateralFaces }: StrategyResources,
	{ order, strategyRank }: StrategyDefinition,
): ParallelStrategyPlan {
	const frame = parallelFrame(input, ports, order);
	const allocation = allocateParallelRoutes(input, frame);
	const domains: readonly TrackAssignmentDomain[] = [
		{
			id: 'gutter',
			edge: allocation.gutter.edge,
			trackCount: allocation.gutter.edge.capacity,
			keys: input.plans.map(({ id }) => id),
			baseline: allocation.gutter,
		},
		{
			id: 'rail',
			edge: allocation.exteriorRail.edge,
			trackCount: frame.crossLanePlans.length,
			keys: activeRailKeys(frame, order),
			baseline: allocation.exteriorRail,
		},
	];
	const first = trackAllocationProducts(domains).next();

	return {
		order,
		strategyRank,
		frame,
		allocation,
		domains,
		baselineKey: defined(first.value).key,
		total: trackAllocationProductCount(domains),
		contracts,
		lateralFaces,
		localFrames: new Map([['', { frame, allocation }]]),
	};
}

export function parallelStrategyPlans(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	contracts: readonly RegionIncidentContract[],
): readonly ParallelStrategyPlan[] {
	const lateralFaces = new Map<string, LateralFaces>(
		input.plans.map(({ id, from, to, sourceSide, targetSide }) => [
			id,
			{
				source: JSON.stringify([from, sourceSide]),
				target: JSON.stringify([to, targetSide]),
			},
		]),
	);
	const resources = { contracts, lateralFaces };
	return parallelOrders(contracts).map((order, strategyRank) =>
		strategyPlan(input, ports, resources, { order, strategyRank }),
	);
}

function strategyId(plan: ParallelStrategyPlan, acceptBridges: boolean): string {
	if (acceptBridges) return `parallel/bridged/${plan.order}`;
	return `parallel/${plan.order}`;
}

function localStrategyFrame(
	input: SharedLaneInput,
	plan: ParallelStrategyPlan,
	rejected: ReadonlySet<string>,
): StrategyFrame {
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
	const frame = parallelFrame(localInput, ports, plan.order);
	const alternative = { frame, allocation: allocateParallelRoutes(localInput, frame) };
	plan.localFrames.set(key, alternative);
	return alternative;
}

/** Main-face placement also changes the lateral ports on the incidence's former face. */
function contactCoupledPlans(
	plan: ParallelStrategyPlan,
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

function resolveCandidateFrame(
	input: SharedLaneInput,
	plan: ParallelStrategyPlan,
	overrides: ParallelRouteTrackOverrides | undefined,
): StrategyFrame {
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
		const contacts = rejectedSharedLaneRouteContacts(geometry.relations);
		if (shapes.size === 0 && contacts.size === 0) return { frame, allocation };
		const previousCount = rejected.size;
		for (const id of shapes) rejected.add(id);
		for (const id of contactCoupledPlans(plan, frame, contacts)) rejected.add(id);
		if (rejected.size === previousCount) return { frame, allocation };
		selected = localStrategyFrame(input, plan, rejected);
	}
	throw new Error('Main-face fallback did not converge.');
}

function baselineCandidate(
	input: SharedLaneInput,
	plan: ParallelStrategyPlan,
	acceptBridges: boolean,
): ParallelRouteCandidate {
	const id = strategyId(plan, acceptBridges);
	const selected = resolveCandidateFrame(input, plan, undefined);
	return {
		order: plan.order,
		strategyRank: plan.strategyRank,
		frame: selected.frame,
		allocation: selected.allocation,
		strategyId: id,
		candidateId: id,
		allocationKey: plan.baselineKey,
		historicalRank: plan.strategyRank,
	};
}

function allocationCandidate(
	input: SharedLaneInput,
	plan: ParallelStrategyPlan,
	product: TrackAllocationProduct,
	acceptBridges: boolean,
): ParallelRouteCandidate {
	const gutter = defined(product.allocations[0]);
	const rail = defined(product.allocations[1]);
	const overrides: ParallelRouteTrackOverrides = {
		gutter,
		railTrackByKey: rail.trackByKey,
	};
	const id = strategyId(plan, acceptBridges);
	const selected = resolveCandidateFrame(input, plan, overrides);
	return {
		order: plan.order,
		strategyRank: plan.strategyRank,
		frame: selected.frame,
		allocation: selected.allocation,
		strategyId: id,
		candidateId: `${id}/${product.key}`,
		allocationKey: product.key,
		historicalRank: undefined,
	};
}

export function* parallelRouteCandidates(
	input: SharedLaneInput,
	plans: readonly ParallelStrategyPlan[],
	acceptBridges: boolean,
): Generator<ParallelRouteCandidate, undefined, void> {
	for (const plan of plans) yield baselineCandidate(input, plan, acceptBridges);
	const alternatives: (Generator<TrackAllocationProduct> | undefined)[] = plans.map((plan) => {
		const products = trackAllocationProducts(plan.domains);
		products.next();
		return products;
	});
	let remaining = alternatives.length;
	while (remaining > 0) {
		for (const [index, products] of alternatives.entries()) {
			if (products === undefined) continue;
			const next = products.next();
			if (next.done === true) {
				alternatives[index] = undefined;
				remaining -= 1;
				continue;
			}
			yield allocationCandidate(input, defined(plans[index]), next.value, acceptBridges);
		}
	}
}

export function parallelCandidateTotal(plans: readonly ParallelStrategyPlan[]): string {
	let total = 0n;
	for (const plan of plans) total += plan.total;
	return total.toString();
}
