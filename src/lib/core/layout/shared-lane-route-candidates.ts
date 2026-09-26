import { compareCanonicalStrings } from '../canonical-string';
import { defined } from '../document/logic-document';
import { routeRuns, validatedBridges } from './bridge-oracle';
import type { RegionIncidentContract, RegionSolvedIncident } from './region-incident-contract';
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

export interface LaneRouteCandidateIdentity {
	readonly historicalRank: number | undefined;
	readonly allocationKey: string;
	readonly strategyId: string;
	readonly candidateId: string;
}

export interface RankedLaneRouteSelection<Selection> {
	readonly selected: Selection;
	readonly candidate: LaneRouteCandidateIdentity;
	readonly bridges: number;
	readonly length: number;
	readonly bends: number;
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

function activeRailIds(frame: SharedLaneFrame, order: ParallelRouteOrder): readonly string[] {
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
			relationIds: input.plans.map(({ id }) => id),
			baseline: allocation.gutter,
		},
		{
			id: 'rail',
			edge: allocation.exteriorRail.edge,
			trackCount: frame.crossLanePlans.length,
			relationIds: activeRailIds(frame, order),
			baseline: allocation.exteriorRail,
		},
	];
	const first = trackAllocationProducts(domains).next();
	if (first.done === true) throw new Error('Lane route allocation must include its baseline.');
	return {
		order,
		strategyRank,
		frame,
		allocation,
		domains,
		baselineKey: first.value.key,
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
		railTrackByRelationId: rail.trackByRelationId,
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
	for (const plan of plans) {
		const products = trackAllocationProducts(plan.domains);
		products.next();
		for (const product of products) yield allocationCandidate(input, plan, product, acceptBridges);
	}
}

export function parallelCandidateTotal(plans: readonly ParallelStrategyPlan[]): string {
	let total = 0n;
	for (const plan of plans) total += plan.total;
	return total.toString();
}

function pathLength(points: readonly { readonly x: number; readonly y: number }[]): number {
	let length = 0;
	for (let index = 1; index < points.length; index += 1) {
		const previous = defined(points[index - 1]);
		const current = defined(points[index]);
		const horizontalLength = Math.abs(current.x - previous.x);
		const verticalLength = Math.abs(current.y - previous.y);
		length += horizontalLength + verticalLength;
	}
	return length;
}

export function rankLaneRouteSelection<
	Selection extends {
		readonly geometry: SharedLaneGeometry;
		readonly incidents: readonly RegionSolvedIncident[];
	},
>(selected: Selection, candidate: LaneRouteCandidateIdentity): RankedLaneRouteSelection<Selection> {
	let length = 0;
	let bends = 0;
	for (const route of selected.geometry.relations) {
		length += pathLength(route.points);
		bends += Math.max(0, routeRuns(route).length - 1);
	}
	for (const incident of selected.incidents) {
		length += pathLength(incident.points);
		const route = {
			id: `${incident.relationId}/${incident.endpointId}`,
			points: incident.points,
		};
		bends += Math.max(0, routeRuns(route).length - 1);
	}
	return {
		selected,
		candidate,
		bridges: validatedBridges(selected.geometry.relations).length,
		length,
		bends,
	};
}

function historicalRankOrder(left: number | undefined, right: number | undefined): number {
	if (left === right) return 0;
	if (left === undefined) return 1;
	if (right === undefined) return -1;
	return left - right;
}

export function laneRouteSelectionIsBetter<Selection>(
	candidate: RankedLaneRouteSelection<Selection>,
	incumbent: RankedLaneRouteSelection<Selection>,
): boolean {
	if (candidate.bridges !== incumbent.bridges) return candidate.bridges < incumbent.bridges;
	if (candidate.length !== incumbent.length) return candidate.length < incumbent.length;
	if (candidate.bends !== incumbent.bends) return candidate.bends < incumbent.bends;
	const historyOrder = historicalRankOrder(
		candidate.candidate.historicalRank,
		incumbent.candidate.historicalRank,
	);
	if (historyOrder !== 0) return historyOrder < 0;
	const allocationOrder = compareCanonicalStrings(
		candidate.candidate.allocationKey,
		incumbent.candidate.allocationKey,
	);
	if (allocationOrder !== 0) return allocationOrder < 0;
	const strategyOrder = compareCanonicalStrings(
		candidate.candidate.strategyId,
		incumbent.candidate.strategyId,
	);
	if (strategyOrder !== 0) return strategyOrder < 0;
	return (
		compareCanonicalStrings(candidate.candidate.candidateId, incumbent.candidate.candidateId) < 0
	);
}
