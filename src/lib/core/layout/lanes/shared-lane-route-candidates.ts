import { defined } from '../../document/logic-document';
import type { RegionIncidentContract } from '../regions/model/region-incident-contract';
import {
	type TrackAllocationProduct,
	trackAllocationProductCount,
	trackAllocationProducts,
	type TrackAssignmentDomain,
} from './shared-lane-allocation-search';
import { makeSharedLaneFrame, type SharedLaneFrame } from './shared-lane-frame';
import type { SharedLaneInput } from './shared-lane-model';
import type { SharedLanePorts } from './shared-lane-ports';
import {
	type ParallelFramePlan,
	type ParallelLateralFaces,
	type ParallelStrategyFrame,
	type ParallelStrategyResources,
	resolveParallelCandidateFrame,
} from './shared-lane-route-frame';
import {
	allocateParallelRoutes,
	ParallelRouteOrder,
	type ParallelRouteTrackOverrides,
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

export interface ParallelRouteCandidate extends ParallelStrategyFrame, StrategyDefinition {
	readonly strategyId: string;
	readonly candidateId: string;
	readonly allocationKey: string;
	readonly historicalRank: number | undefined;
}

interface StrategyDefinition {
	readonly order: ParallelRouteOrder;
	readonly strategyRank: number;
}

enum ParallelContactPolicy {
	Strict = 'strict',
	Bridged = 'bridged',
	BridgedLocalFallback = 'bridged-local-fallback',
}

interface ParallelCandidateCounts {
	readonly baseline: number;
	readonly total: string;
}

interface ParallelStrategyPlan extends ParallelFramePlan, StrategyDefinition {
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
	{ contracts, lateralFaces }: ParallelStrategyResources,
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
	const lateralFaces = new Map<string, ParallelLateralFaces>(
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

function strategyId(plan: ParallelStrategyPlan, policy: ParallelContactPolicy): string {
	if (policy === ParallelContactPolicy.Strict) return `parallel/${plan.order}`;
	let suffix = '';
	if (policy === ParallelContactPolicy.BridgedLocalFallback) suffix = '/local-fallback';
	return `parallel/bridged/${plan.order}${suffix}`;
}

function baselineCandidate(
	input: SharedLaneInput,
	plan: ParallelStrategyPlan,
	policy: ParallelContactPolicy,
): ParallelRouteCandidate {
	const id = strategyId(plan, policy);
	const selected = resolveParallelCandidateFrame(
		input,
		plan,
		policy === ParallelContactPolicy.Bridged,
		undefined,
	);
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
	policy: ParallelContactPolicy,
): ParallelRouteCandidate {
	const gutter = defined(product.allocations[0]);
	const rail = defined(product.allocations[1]);
	const overrides: ParallelRouteTrackOverrides = {
		gutter,
		railTrackByKey: rail.trackByKey,
	};
	const id = strategyId(plan, policy);
	const selected = resolveParallelCandidateFrame(
		input,
		plan,
		policy === ParallelContactPolicy.Bridged,
		overrides,
	);
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

function* allocationCandidates(
	input: SharedLaneInput,
	plans: readonly ParallelStrategyPlan[],
	acceptBridges: boolean,
): Generator<ParallelRouteCandidate, undefined, void> {
	let policy = ParallelContactPolicy.Strict;
	if (acceptBridges) policy = ParallelContactPolicy.Bridged;
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
			const plan = defined(plans[index]);
			yield allocationCandidate(input, plan, next.value, policy);
			if (acceptBridges && plan.frame.mainFacePlanIds.size > 0)
				yield allocationCandidate(
					input,
					plan,
					next.value,
					ParallelContactPolicy.BridgedLocalFallback,
				);
		}
	}
}

export function* parallelRouteCandidates(
	input: SharedLaneInput,
	plans: readonly ParallelStrategyPlan[],
	acceptBridges: boolean,
): Generator<ParallelRouteCandidate, undefined, void> {
	let policy = ParallelContactPolicy.Strict;
	if (acceptBridges) policy = ParallelContactPolicy.Bridged;
	for (const plan of plans) yield baselineCandidate(input, plan, policy);
	for (const plan of plans)
		if (acceptBridges && plan.frame.mainFacePlanIds.size > 0)
			yield baselineCandidate(input, plan, ParallelContactPolicy.BridgedLocalFallback);
	yield* allocationCandidates(input, plans, acceptBridges);
}

export function parallelCandidateCounts(
	plans: readonly ParallelStrategyPlan[],
	acceptBridges: boolean,
): ParallelCandidateCounts {
	let baseline = 0;
	let total = 0n;
	for (const plan of plans) {
		let count = 1;
		if (acceptBridges && plan.frame.mainFacePlanIds.size > 0) count = 2;
		baseline += count;
		total += plan.total * BigInt(count);
	}
	return { baseline, total: total.toString() };
}
