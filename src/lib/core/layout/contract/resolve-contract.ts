import { compareCanonicalStrings } from '../../canonical-string';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { evaluateDedicatedLayout } from '../layout-engine';
import type { LayoutMeasurements, LayoutResult } from '../layout-types';
import { bestWithinBudget, validatedSearchBudget } from '../search/bounded-search';
import { prepareLayout } from '../structure/prepare-layout';
import { type CandidateFaceBranch, candidateFaceBranches } from './candidate-face-branches';
import { materializeContractCandidate } from './candidate-layout';
import {
	AdjacentContractShape,
	buildAdjacentLayoutContract,
	type LayoutContract,
	LayoutContractBuildStatus,
	LayoutContractUnknownReason,
} from './layout-contract';
import {
	type CandidateFaceChoice,
	type CandidateGeometryReason,
	validateContractCandidate,
} from './validate-candidate';

export enum LayoutContractResolutionStatus {
	Selected = 'selected',
	Unknown = 'unknown',
	Incomplete = 'incomplete',
}

enum LayoutContractResolutionUnknownReason {
	NoValidatedCandidate = 'no-validated-candidate',
}

export enum ContractBranchStatus {
	Accepted = 'accepted',
	GeometryRejected = 'geometry-rejected',
	MaterializationFailed = 'materialization-failed',
	DifferentialMismatch = 'differential-mismatch',
}

interface ContractBranchEvaluation {
	readonly branchId: string;
	readonly status: ContractBranchStatus;
	readonly geometryReason?: CandidateGeometryReason;
}

interface SelectedContractBranch {
	readonly branchId: string;
	readonly candidateId: string;
	readonly choices: readonly CandidateFaceChoice[];
	readonly totalGrowth: number;
	readonly forcedInversions: number;
	readonly layout: LayoutResult;
}

interface SelectedLayoutContract {
	readonly status: LayoutContractResolutionStatus.Selected;
	readonly contract: LayoutContract;
	readonly selection: SelectedContractBranch;
	readonly evaluations: readonly ContractBranchEvaluation[];
}

interface UnknownLayoutContractResolution {
	readonly status: LayoutContractResolutionStatus.Unknown;
	readonly reason: LayoutContractUnknownReason | LayoutContractResolutionUnknownReason;
	readonly contract?: LayoutContract;
	readonly evaluations: readonly ContractBranchEvaluation[];
}

interface IncompleteLayoutContractResolution {
	readonly status: LayoutContractResolutionStatus.Incomplete;
	readonly contract: LayoutContract;
	readonly exploredBranches: number;
	readonly budget: number;
	readonly incumbent?: SelectedContractBranch;
	readonly evaluations: readonly ContractBranchEvaluation[];
}

export type LayoutContractResolution =
	SelectedLayoutContract | UnknownLayoutContractResolution | IncompleteLayoutContractResolution;

function better(left: SelectedContractBranch, right: SelectedContractBranch): boolean {
	const growth = left.totalGrowth - right.totalGrowth;
	if (growth !== 0) return growth < 0;
	const inversions = left.forcedInversions - right.forcedInversions;
	if (inversions !== 0) return inversions < 0;
	return compareCanonicalStrings(left.branchId, right.branchId) < 0;
}

function selectedBranch(branch: CandidateFaceBranch, layout: LayoutResult): SelectedContractBranch {
	return {
		branchId: branch.id,
		candidateId: branch.candidate.id,
		choices: branch.choices,
		totalGrowth: branch.totalGrowth,
		forcedInversions: branch.candidate.conflicts.inversions.length,
		layout,
	};
}

interface BranchEvaluationResult {
	readonly evaluation: ContractBranchEvaluation;
	readonly selection?: SelectedContractBranch;
}

function evaluateBranch(input: {
	readonly branch: CandidateFaceBranch;
	readonly graph: LogicGraph;
	readonly measurements: LayoutMeasurements;
	readonly baseline: LayoutResult;
	readonly materialized: Map<string, LayoutResult | undefined>;
}): BranchEvaluationResult {
	const { branch, graph, measurements, baseline, materialized } = input;
	const { candidate } = branch;
	let layout = materialized.get(candidate.id);
	if (!materialized.has(candidate.id)) {
		layout = materializeContractCandidate(graph, measurements, candidate);
		materialized.set(candidate.id, layout);
	}
	if (layout === undefined)
		return {
			evaluation: { branchId: branch.id, status: ContractBranchStatus.MaterializationFailed },
		};
	const validation = validateContractCandidate({
		graph,
		candidate,
		measurements,
		layout,
		choices: branch.choices,
	});
	if (!validation.valid)
		return {
			evaluation: {
				branchId: branch.id,
				status: ContractBranchStatus.GeometryRejected,
				geometryReason: validation.reason,
			},
		};
	if (JSON.stringify(layout) !== JSON.stringify(baseline))
		return {
			evaluation: { branchId: branch.id, status: ContractBranchStatus.DifferentialMismatch },
		};
	return {
		evaluation: { branchId: branch.id, status: ContractBranchStatus.Accepted },
		selection: selectedBranch(branch, layout),
	};
}

/** Exhaustive only within the declared branch budget and the sparse adjacent 3+1 contract. */
export function resolveAdjacentLayoutContract(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: { readonly maxBranches?: number } = {},
): LayoutContractResolution {
	const budget = validatedSearchBudget(options.maxBranches ?? 256);
	const built = buildAdjacentLayoutContract(graph, ranks, measurements);
	if (built.status === LayoutContractBuildStatus.Unknown)
		return {
			status: LayoutContractResolutionStatus.Unknown,
			reason: built.reason,
			evaluations: [],
		};
	const { contract } = built;
	if (contract.shape !== AdjacentContractShape.ThreePlusOne)
		return {
			status: LayoutContractResolutionStatus.Unknown,
			reason: LayoutContractUnknownReason.UnsupportedShape,
			contract,
			evaluations: [],
		};
	// Differential comparison must retain the contract's documentary order on both sides.
	const baseline = evaluateDedicatedLayout(prepareLayout(graph, ranks), measurements);
	const materialized = new Map<string, LayoutResult | undefined>();
	const { evaluations, explored, exhaustive, incumbent } = bestWithinBudget({
		alternatives: contract.candidates.flatMap(candidateFaceBranches),
		budget,
		evaluate: (branch) => evaluateBranch({ branch, graph, measurements, baseline, materialized }),
		better,
	});
	if (!exhaustive) {
		const incomplete: IncompleteLayoutContractResolution = {
			status: LayoutContractResolutionStatus.Incomplete,
			contract,
			exploredBranches: explored,
			budget,
			evaluations,
		};
		if (incumbent !== undefined) return { ...incomplete, incumbent };
		return incomplete;
	}
	if (incumbent === undefined)
		return {
			status: LayoutContractResolutionStatus.Unknown,
			reason: LayoutContractResolutionUnknownReason.NoValidatedCandidate,
			contract,
			evaluations,
		};
	return {
		status: LayoutContractResolutionStatus.Selected,
		contract,
		selection: incumbent,
		evaluations,
	};
}
