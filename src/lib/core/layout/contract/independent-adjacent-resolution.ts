import { compareCanonicalStrings } from '../../canonical-string';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { bestWithinBudget, validatedSearchBudget } from '../bounded-search';
import { unbridgedCrossings } from '../bridge-contact';
import { routeBridgeAnalysis } from '../bridge-oracle';
import type { LayoutMeasurements, LayoutResult } from '../layout-types';
import { layoutRouteCost, type RouteCost } from '../routing/route-cost';
import { type CandidateFaceBranch, candidateFaceBranches } from './candidate-face-branches';
import {
	AdjacentGeometryMode,
	materializeIndependentAdjacentBridgeGeometry,
	materializeIndependentAdjacentGeometry,
} from './independent-adjacent-geometry';
import {
	type AdjacentContractShape,
	buildAdjacentLayoutContract,
	type LayoutContract,
	LayoutContractBuildStatus,
	type LayoutContractUnknownReason,
} from './layout-contract';
import { type CandidateFaceChoice, validateContractCandidate } from './validate-candidate';

export enum IndependentAdjacentStatus {
	Selected = 'selected',
	Incomplete = 'incomplete',
	Unknown = 'unknown',
}

export enum IndependentAdjacentBranchStatus {
	Accepted = 'accepted',
	MaterializationFailed = 'materialization-failed',
	GeometryRejected = 'geometry-rejected',
	BridgeUnavailable = 'bridge-unavailable',
	CrossingRejected = 'crossing-rejected',
}

export enum IndependentAdjacentGlobalStatus {
	Undetermined = 'undetermined',
}

enum IndependentAdjacentUnknownReason {
	NoValidatedCandidate = 'no-validated-candidate',
}

/** The default detour tolerances over the best bridged candidate. */
export const DETOUR_AREA_TOLERANCE = 0.25;
export const DETOUR_LENGTH_TOLERANCE = 0.2;

export interface IndependentAdjacentPolicy {
	readonly detourAreaTolerance: number;
	readonly detourLengthTolerance: number;
}

const DEFAULT_INDEPENDENT_ADJACENT_POLICY: IndependentAdjacentPolicy = {
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
	readonly detourGrowth: number;
	readonly bridgeGrowth: number;
	readonly detourBranchId: string;
	readonly bridgeBranchId: string;
	readonly policy: IndependentAdjacentPolicy;
}

export interface IndependentAdjacentCostCandidate {
	readonly growth: number;
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

interface IndependentAdjacentEvaluation {
	readonly branchId: string;
	readonly status: IndependentAdjacentBranchStatus;
}

interface SearchTrace {
	readonly contract: LayoutContract;
	readonly scope: AdjacentContractShape;
	readonly globalStatus: IndependentAdjacentGlobalStatus.Undetermined;
	readonly omittedCrossingCandidates: number;
	readonly exploredBranches: number;
	readonly totalBranches: number;
	readonly evaluations: readonly IndependentAdjacentEvaluation[];
	/** The declared costs of both issues, present when the search compared them. */
	readonly comparison?: IndependentAdjacentComparison | undefined;
}

interface SelectedResolution extends SearchTrace {
	readonly status: IndependentAdjacentStatus.Selected;
	readonly selection: IndependentAdjacentSelection;
}

interface IncompleteResolution extends SearchTrace {
	readonly status: IndependentAdjacentStatus.Incomplete;
	readonly incumbent?: IndependentAdjacentSelection;
}

interface UnknownResolution {
	readonly status: IndependentAdjacentStatus.Unknown;
	readonly reason: LayoutContractUnknownReason | IndependentAdjacentUnknownReason;
	readonly contract?: LayoutContract;
	readonly evaluations: readonly IndependentAdjacentEvaluation[];
}

export type IndependentAdjacentResolution =
	SelectedResolution | IncompleteResolution | UnknownResolution;

function better(left: IndependentAdjacentSelection, right: IndependentAdjacentSelection): boolean {
	if (left.growth !== right.growth) return left.growth < right.growth;
	if (left.cost.area !== right.cost.area) return left.cost.area < right.cost.area;
	if (left.cost.routeLength !== right.cost.routeLength)
		return left.cost.routeLength < right.cost.routeLength;
	if (left.cost.bends !== right.cost.bends) return left.cost.bends < right.cost.bends;
	return compareCanonicalStrings(left.branchId, right.branchId) < 0;
}

interface IndependentBranchResult {
	readonly evaluation: IndependentAdjacentEvaluation;
	readonly selection?: IndependentAdjacentSelection;
}

interface IndependentAdjacentGeometryBranch {
	readonly branch: CandidateFaceBranch;
	readonly id: string;
	readonly geometry: AdjacentGeometryMode;
}

function evaluateBranch(input: {
	readonly branch: IndependentAdjacentGeometryBranch;
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
}): IndependentBranchResult {
	const { branch, graph, measurements } = input;
	let layout: LayoutResult | undefined;
	if (branch.geometry === AdjacentGeometryMode.Bridge)
		layout = materializeIndependentAdjacentBridgeGeometry(
			graph,
			measurements,
			branch.branch.candidate,
			branch.branch.choices,
		);
	else
		layout = materializeIndependentAdjacentGeometry(
			graph,
			measurements,
			branch.branch.candidate,
			branch.branch.choices,
		);
	if (layout === undefined)
		return {
			evaluation: {
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.MaterializationFailed,
			},
		};
	const checked = validateContractCandidate({
		graph,
		measurements,
		candidate: branch.branch.candidate,
		choices: branch.branch.choices,
		layout,
	});
	if (!checked.valid)
		return {
			evaluation: {
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.GeometryRejected,
			},
		};
	const analysis = routeBridgeAnalysis(layout.relations);
	if (branch.geometry === AdjacentGeometryMode.Bridge && analysis.bridges.length === 0)
		return {
			evaluation: {
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.BridgeUnavailable,
			},
		};
	if (unbridgedCrossings(analysis).length > 0)
		return {
			evaluation: {
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.CrossingRejected,
			},
		};
	return {
		evaluation: { branchId: branch.id, status: IndependentAdjacentBranchStatus.Accepted },
		selection: {
			candidateId: branch.branch.candidate.id,
			branchId: branch.id,
			choices: branch.branch.choices,
			growth: branch.branch.growth,
			bridged: analysis.crossings.length > 0,
			cost: layoutRouteCost(layout),
			layout,
		},
	};
}

/** The best accepted selection of one issue, or `undefined` when the issue has no candidate. */
function bestOfIssue(
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
	if (detour.growth !== bridge.growth) {
		if (detour.growth < bridge.growth) return detour;
		return bridge;
	}
	const areaOverhead = detour.cost.area / bridge.cost.area - 1;
	const lengthOverhead = detour.cost.routeLength / bridge.cost.routeLength - 1;
	if (areaOverhead > policy.detourAreaTolerance) return bridge;
	if (lengthOverhead > policy.detourLengthTolerance) return bridge;
	return detour;
}

/** Resolves the independently materialized adjacent contract, including inverted orders. */
export function resolveIndependentAdjacentContract(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: {
		readonly maxBranches?: number;
		readonly policy?: IndependentAdjacentPolicy;
	} = {},
): IndependentAdjacentResolution {
	const budget = validatedSearchBudget(options.maxBranches ?? 256);
	const policy = options.policy ?? DEFAULT_INDEPENDENT_ADJACENT_POLICY;
	const built = buildAdjacentLayoutContract(graph, ranks, measurements);
	if (built.status === LayoutContractBuildStatus.Unknown)
		return { status: IndependentAdjacentStatus.Unknown, reason: built.reason, evaluations: [] };
	const { contract } = built;
	const omittedCrossingCandidates = 0;
	const alternatives = contract.candidates.flatMap(candidateFaceBranches).flatMap((branch) => [
		{ branch, id: `${branch.id}:bridge`, geometry: AdjacentGeometryMode.Bridge },
		{ branch, id: branch.id, geometry: AdjacentGeometryMode.Detour },
	]);
	const selections: IndependentAdjacentSelection[] = [];
	const { evaluations, explored, exhaustive, incumbent } = bestWithinBudget({
		alternatives,
		budget,
		evaluate: (branch) => {
			const result = evaluateBranch({ branch, graph, measurements });
			if (result.selection !== undefined) selections.push(result.selection);
			return result;
		},
		better,
	});
	const detour = bestOfIssue(selections, IndependentAdjacentIssue.Detour);
	const bridge = bestOfIssue(selections, IndependentAdjacentIssue.Bridge);
	const selected = arbitrateIssue(detour, bridge, policy);
	let comparison: IndependentAdjacentComparison | undefined;
	if (selected !== undefined) comparison = compareIssues(detour, bridge, selected, policy);
	let trace: SearchTrace = {
		contract,
		scope: contract.shape,
		globalStatus: IndependentAdjacentGlobalStatus.Undetermined,
		omittedCrossingCandidates,
		exploredBranches: explored,
		totalBranches: alternatives.length,
		evaluations,
	};
	if (comparison !== undefined) trace = { ...trace, comparison };
	if (!exhaustive) {
		if (incumbent === undefined) return { ...trace, status: IndependentAdjacentStatus.Incomplete };
		return { ...trace, status: IndependentAdjacentStatus.Incomplete, incumbent };
	}
	if (selected === undefined)
		return {
			status: IndependentAdjacentStatus.Unknown,
			reason: IndependentAdjacentUnknownReason.NoValidatedCandidate,
			contract,
			evaluations,
		};
	return { ...trace, status: IndependentAdjacentStatus.Selected, selection: selected };
}

/** The declared costs of both issues, reported only when a search held each of them. */
function compareIssues(
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
		detourGrowth: detour.growth,
		bridgeGrowth: bridge.growth,
		detourBranchId: detour.branchId,
		bridgeBranchId: bridge.branchId,
		policy,
	};
}
