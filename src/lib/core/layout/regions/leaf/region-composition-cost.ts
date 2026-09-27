import {
	arbitrateIssue,
	DEFAULT_INDEPENDENT_ADJACENT_POLICY,
} from '../../contract/independent-adjacent-policy';
import { layoutRouteCost, type RouteCost } from '../../geometry/layout-route-cost';
import {
	RegionCompositionIssue,
	type RegionLayoutSelected,
} from '../model/region-composition-types';

export interface CompositionCostCandidate {
	readonly attempt: RegionLayoutSelected;
	readonly cost: RouteCost;
	readonly indices: readonly number[];
}

export function compositionCostCandidate(
	attempt: RegionLayoutSelected,
	indices: readonly number[],
): CompositionCostCandidate {
	return { attempt, cost: layoutRouteCost(attempt.layout), indices: [...indices] };
}

export function betterCompositionCost(
	candidate: CompositionCostCandidate,
	incumbent: CompositionCostCandidate,
): boolean {
	if (candidate.cost.area !== incumbent.cost.area) return candidate.cost.area < incumbent.cost.area;
	if (candidate.cost.routeLength !== incumbent.cost.routeLength)
		return candidate.cost.routeLength < incumbent.cost.routeLength;
	return candidate.cost.bends < incumbent.cost.bends;
}

/** Composed geometry has no adjacent-contract differential growth; its frame carries area. */
export interface CompositionIssueSelection {
	readonly selected: CompositionCostCandidate;
	readonly issue: RegionCompositionIssue;
}

export function chooseCompositionIssue(
	detour: CompositionCostCandidate | undefined,
	bridge: CompositionCostCandidate | undefined,
): CompositionIssueSelection | undefined {
	let detourCost:
		| (CompositionCostCandidate & {
				readonly totalGrowth: number;
				readonly differentialGrowth: number;
		  })
		| undefined;
	let bridgeCost: typeof detourCost;
	if (detour !== undefined) detourCost = { ...detour, totalGrowth: 0, differentialGrowth: 0 };
	if (bridge !== undefined) bridgeCost = { ...bridge, totalGrowth: 0, differentialGrowth: 0 };
	const selected = arbitrateIssue(detourCost, bridgeCost, DEFAULT_INDEPENDENT_ADJACENT_POLICY);
	if (selected === undefined) return undefined;
	let issue = RegionCompositionIssue.Detour;
	if (selected.attempt === bridge?.attempt) issue = RegionCompositionIssue.Bridge;
	return { selected, issue };
}
