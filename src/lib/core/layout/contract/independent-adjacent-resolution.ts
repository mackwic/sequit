import { compareCanonicalStrings } from '../../canonical-string';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { bestWithinBudget, validatedSearchBudget } from '../bounded-search';
import { unbridgedCrossings } from '../bridge-contact';
import { routeBridgeAnalysis } from '../bridge-oracle';
import type { LayoutMeasurements, LayoutResult } from '../layout-types';
import { layoutRouteCost, type RouteCost } from '../routing/route-cost';
import { type CandidateFaceBranch, candidateFaceBranches } from './candidate-face-branches';
import { materializeIndependentAdjacentGeometry } from './independent-adjacent-geometry';
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
	CrossingRejected = 'crossing-rejected',
}

export enum IndependentAdjacentGlobalStatus {
	Undetermined = 'undetermined',
}

enum IndependentAdjacentUnknownReason {
	NoValidatedCandidate = 'no-validated-candidate',
}

/**
 * The detour tolerances over the best bridged candidate. The 3+1 witness measures the crossing-free
 * detour at +46.52 % of area and +37.95 % of route length over the bridged layout, so both reject
 * that detour with a factor of about two, while a cheap detour keeps its crossings unwarranted.
 */
export const DETOUR_AREA_TOLERANCE = 0.25;
export const DETOUR_LENGTH_TOLERANCE = 0.2;

/** The two admissible issues of an adjacent crossing: the detour and the validated bridge. */
export enum IndependentAdjacentIssue {
	Detour = 'detour',
	Bridge = 'bridge',
}

/** Both declared costs when a search compares a detour with a bridged candidate. */
export interface IndependentAdjacentComparison {
	readonly selected: IndependentAdjacentIssue;
	readonly detour: RouteCost;
	readonly bridge: RouteCost;
}

export interface IndependentAdjacentSelection {
	readonly candidateId: string;
	readonly branchId: string;
	readonly choices: readonly CandidateFaceChoice[];
	readonly growth: number;
	/** True when the selection keeps a strict crossing that a validated bridge carries. */
	readonly bridged: boolean;
	readonly cost: RouteCost;
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
	return compareCanonicalStrings(left.branchId, right.branchId) < 0;
}

interface IndependentBranchResult {
	readonly evaluation: IndependentAdjacentEvaluation;
	readonly selection?: IndependentAdjacentSelection;
}

function evaluateBranch(input: {
	readonly branch: CandidateFaceBranch;
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
}): IndependentBranchResult {
	const { branch, graph, measurements } = input;
	const layout = materializeIndependentAdjacentGeometry(
		graph,
		measurements,
		branch.candidate,
		branch.choices,
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
		candidate: branch.candidate,
		choices: branch.choices,
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
			candidateId: branch.candidate.id,
			branchId: branch.id,
			choices: branch.choices,
			growth: branch.growth,
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

/**
 * The declared arbitration: the crossing-free detour stays in charge, and the validated bridge wins
 * only when there is no detour or when the detour pays more than one of the two tolerances.
 */
function arbitrateIssue(
	detour: IndependentAdjacentSelection | undefined,
	bridge: IndependentAdjacentSelection | undefined,
): IndependentAdjacentSelection | undefined {
	if (bridge === undefined) return detour;
	if (detour === undefined) return bridge;
	const areaOverhead = detour.cost.area / bridge.cost.area - 1;
	const lengthOverhead = detour.cost.routeLength / bridge.cost.routeLength - 1;
	if (areaOverhead > DETOUR_AREA_TOLERANCE) return bridge;
	if (lengthOverhead > DETOUR_LENGTH_TOLERANCE) return bridge;
	return detour;
}

/** Resolves the independently materialized adjacent contract, including inverted orders. */
export function resolveIndependentAdjacentContract(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: { readonly maxBranches?: number } = {},
): IndependentAdjacentResolution {
	const budget = validatedSearchBudget(options.maxBranches ?? 256);
	const built = buildAdjacentLayoutContract(graph, ranks, measurements);
	if (built.status === LayoutContractBuildStatus.Unknown)
		return { status: IndependentAdjacentStatus.Unknown, reason: built.reason, evaluations: [] };
	const { contract } = built;
	const omittedCrossingCandidates = 0;
	const alternatives = contract.candidates.flatMap(candidateFaceBranches);
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
	const selected = arbitrateIssue(detour, bridge);
	let comparison: IndependentAdjacentComparison | undefined;
	if (selected !== undefined) comparison = compareIssues(detour, bridge, selected);
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
): IndependentAdjacentComparison | undefined {
	if (detour === undefined || bridge === undefined) return undefined;
	let issue = IndependentAdjacentIssue.Detour;
	if (selected.bridged) issue = IndependentAdjacentIssue.Bridge;
	return { selected: issue, detour: detour.cost, bridge: bridge.cost };
}
