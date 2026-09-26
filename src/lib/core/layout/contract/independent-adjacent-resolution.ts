import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { unbridgedCrossings } from '../bridges/bridge-contact';
import { routeBridgeAnalysis } from '../bridges/bridge-oracle';
import type { LayoutMeasurements, LayoutResult } from '../layout-types';
import { layoutRouteCost } from '../routing/route-cost';
import { bestWithinBudget, validatedSearchBudget } from '../search/bounded-search';
import { type CandidateFaceBranch, candidateFaceBranches } from './candidate-face-branches';
import {
	AdjacentGeometryMode,
	materializeIndependentAdjacentBridgeGeometry,
	materializeIndependentAdjacentGeometry,
} from './independent-adjacent-geometry';
import {
	arbitrateIssue,
	bestOfIssue,
	better,
	compareIssues,
	DEFAULT_INDEPENDENT_ADJACENT_POLICY,
	type IndependentAdjacentComparison,
	IndependentAdjacentIssue,
	type IndependentAdjacentPolicy,
	type IndependentAdjacentSelection,
} from './independent-adjacent-policy';
import {
	type AdjacentContractShape,
	buildAdjacentLayoutContract,
	type LayoutContract,
	LayoutContractBuildStatus,
	type LayoutContractUnknownReason,
} from './layout-contract';
import { validateContractCandidate } from './validate-candidate';

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
			totalGrowth: branch.branch.totalGrowth,
			differentialGrowth: branch.branch.differentialGrowth,
			bridged: analysis.crossings.length > 0,
			cost: layoutRouteCost(layout),
			layout,
		},
	};
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
