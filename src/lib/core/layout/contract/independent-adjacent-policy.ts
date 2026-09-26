import { compareCanonicalStrings } from '../../canonical-string';
import type { LayoutResult } from '../layout-types';
import type { RouteCost } from '../routing/route-cost';
import type { CandidateFaceChoice } from './validate-candidate';

/** The default detour tolerances over the best bridged candidate. */
export const DETOUR_AREA_TOLERANCE = 0.25;
export const DETOUR_LENGTH_TOLERANCE = 0.2;

export interface IndependentAdjacentPolicy {
	readonly detourAreaTolerance: number;
	readonly detourLengthTolerance: number;
}

export const DEFAULT_INDEPENDENT_ADJACENT_POLICY: IndependentAdjacentPolicy = {
	detourAreaTolerance: DETOUR_AREA_TOLERANCE,
	detourLengthTolerance: DETOUR_LENGTH_TOLERANCE,
};

/** The two admissible issues of an adjacent crossing: the detour and the validated bridge. */
export enum IndependentAdjacentIssue {
	Detour = 'detour',
	Bridge = 'bridge',
}

/** Both declared costs and their source candidates when a search compares the issues. */
export interface IndependentAdjacentComparison {
	readonly selected: IndependentAdjacentIssue;
	readonly detour: RouteCost;
	readonly bridge: RouteCost;
	readonly detourTotalGrowth: number;
	readonly bridgeTotalGrowth: number;
	readonly detourDifferentialGrowth: number;
	readonly bridgeDifferentialGrowth: number;
	readonly detourBranchId: string;
	readonly bridgeBranchId: string;
	readonly policy: IndependentAdjacentPolicy;
}

export interface IndependentAdjacentCostCandidate {
	readonly totalGrowth: number;
	readonly differentialGrowth: number;
	readonly cost: RouteCost;
}

export interface IndependentAdjacentSelection extends IndependentAdjacentCostCandidate {
	readonly candidateId: string;
	readonly branchId: string;
	readonly choices: readonly CandidateFaceChoice[];
	/** True when the selection keeps a strict crossing that a validated bridge carries. */
	readonly bridged: boolean;
	readonly layout: LayoutResult;
}

export function better(
	left: IndependentAdjacentSelection,
	right: IndependentAdjacentSelection,
): boolean {
	if (left.totalGrowth !== right.totalGrowth) return left.totalGrowth < right.totalGrowth;
	if (left.cost.area !== right.cost.area) return left.cost.area < right.cost.area;
	if (left.cost.routeLength !== right.cost.routeLength)
		return left.cost.routeLength < right.cost.routeLength;
	if (left.cost.bends !== right.cost.bends) return left.cost.bends < right.cost.bends;
	return compareCanonicalStrings(left.branchId, right.branchId) < 0;
}

/** The best accepted selection of one issue, or `undefined` when the issue has no candidate. */
export function bestOfIssue(
	selections: readonly IndependentAdjacentSelection[],
	issue: IndependentAdjacentIssue,
): IndependentAdjacentSelection | undefined {
	const wanted = issue === IndependentAdjacentIssue.Bridge;
	let incumbent: IndependentAdjacentSelection | undefined;
	for (const selection of selections) {
		if (selection.bridged !== wanted) continue;
		if (incumbent === undefined || better(selection, incumbent)) incumbent = selection;
	}
	return incumbent;
}

/** Growth is decisive across issues; cost tolerances arbitrate only equal-growth candidates. */
export function arbitrateIssue<T extends IndependentAdjacentCostCandidate>(
	detour: T | undefined,
	bridge: T | undefined,
	policy: IndependentAdjacentPolicy,
): T | undefined {
	if (bridge === undefined) return detour;
	if (detour === undefined) return bridge;
	if (detour.totalGrowth !== bridge.totalGrowth) {
		if (detour.totalGrowth < bridge.totalGrowth) return detour;
		return bridge;
	}
	const areaOverhead = detour.cost.area / bridge.cost.area - 1;
	const lengthOverhead = detour.cost.routeLength / bridge.cost.routeLength - 1;
	if (areaOverhead > policy.detourAreaTolerance) return bridge;
	if (lengthOverhead > policy.detourLengthTolerance) return bridge;
	return detour;
}

/** The declared costs of both issues, reported only when a search held each of them. */
export function compareIssues(
	detour: IndependentAdjacentSelection | undefined,
	bridge: IndependentAdjacentSelection | undefined,
	selected: IndependentAdjacentSelection,
	policy: IndependentAdjacentPolicy,
): IndependentAdjacentComparison | undefined {
	if (detour === undefined || bridge === undefined) return undefined;
	let issue = IndependentAdjacentIssue.Detour;
	if (selected.bridged) issue = IndependentAdjacentIssue.Bridge;
	return {
		selected: issue,
		detour: detour.cost,
		bridge: bridge.cost,
		detourTotalGrowth: detour.totalGrowth,
		bridgeTotalGrowth: bridge.totalGrowth,
		detourDifferentialGrowth: detour.differentialGrowth,
		bridgeDifferentialGrowth: bridge.differentialGrowth,
		detourBranchId: detour.branchId,
		bridgeBranchId: bridge.branchId,
		policy,
	};
}
