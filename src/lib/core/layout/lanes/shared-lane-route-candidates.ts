import { defined } from '../../document/logic-document';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import {
	type TrackAllocationProduct,
	trackAllocationProductCount,
	trackAllocationProducts,
	type TrackAssignmentDomain,
} from './shared-lane-allocation-search';
import { makeSharedLaneFrame, type SharedLaneFrame } from './shared-lane-frame';
import type { SharedLaneGeometry } from './shared-lane-geometry';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
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

export interface ParallelRouteCandidate {
	readonly order: ParallelRouteOrder;
	readonly strategyRank: number;
	readonly frame: SharedLaneFrame;
	readonly allocation: ParallelRouteAllocation;
	readonly strategyId: string;
	readonly candidateId: string;
	readonly allocationKey: string;
	readonly historicalRank: number | undefined;
}

interface ParallelStrategyPlan {
	readonly order: ParallelRouteOrder;
	readonly strategyRank: number;
	readonly frame: SharedLaneFrame;
	readonly allocation: ParallelRouteAllocation;
	readonly domains: readonly TrackAssignmentDomain[];
	readonly baselineKey: string;
	readonly total: bigint;
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
	order: ParallelRouteOrder,
	strategyRank: number,
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
	};
}

export function parallelStrategyPlans(
	input: SharedLaneInput,
	ports: SharedLanePorts,
	contracts: readonly RegionIncidentContract[],
): readonly ParallelStrategyPlan[] {
	return parallelOrders(contracts).map((order, strategyRank) =>
		strategyPlan(input, ports, order, strategyRank),
	);
}

function strategyId(order: ParallelRouteOrder, acceptBridges: boolean): string {
	if (acceptBridges) return `parallel/bridged/${order}`;
	return `parallel/${order}`;
}

function baselineCandidate(
	plan: ParallelStrategyPlan,
	acceptBridges: boolean,
): ParallelRouteCandidate {
	const id = strategyId(plan.order, acceptBridges);
	return {
		order: plan.order,
		strategyRank: plan.strategyRank,
		frame: plan.frame,
		allocation: plan.allocation,
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
	const id = strategyId(plan.order, acceptBridges);
	return {
		order: plan.order,
		strategyRank: plan.strategyRank,
		frame: plan.frame,
		allocation: allocateParallelRoutes(input, plan.frame, overrides),
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
	for (const plan of plans) yield baselineCandidate(plan, acceptBridges);
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
