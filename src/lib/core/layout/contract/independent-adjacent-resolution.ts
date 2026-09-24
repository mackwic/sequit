import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import type { LayoutMeasurements, LayoutResult, Point } from '../layout-types';
import { candidateFaceBranches } from './candidate-face-branches';
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

export interface IndependentAdjacentSelection {
	readonly candidateId: string;
	readonly branchId: string;
	readonly choices: readonly CandidateFaceChoice[];
	readonly growth: number;
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

function strictCrossing(a: Point, b: Point, c: Point, d: Point): boolean {
	if (a.x === b.x && c.y === d.y) {
		const withinVertical = c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y);
		const withinHorizontal = a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x);
		return withinVertical && withinHorizontal;
	}
	if (a.y === b.y && c.x === d.x) {
		const withinHorizontal = c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x);
		const withinVertical = a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y);
		return withinHorizontal && withinVertical;
	}
	return false;
}

function routesCross(first: readonly Point[], second: readonly Point[]): boolean {
	for (let a = 1; a < first.length; a += 1) {
		for (let b = 1; b < second.length; b += 1) {
			if (
				strictCrossing(
					defined(first[a - 1]),
					defined(first[a]),
					defined(second[b - 1]),
					defined(second[b]),
				)
			)
				return true;
		}
	}
	return false;
}

function hasStrictCrossing(layout: LayoutResult): boolean {
	for (const [index, first] of layout.relations.entries())
		for (const second of layout.relations.slice(index + 1))
			if (routesCross(first.points, second.points)) return true;
	return false;
}

function better(left: IndependentAdjacentSelection, right: IndependentAdjacentSelection): boolean {
	if (left.growth !== right.growth) return left.growth < right.growth;
	return compareCanonicalStrings(left.branchId, right.branchId) < 0;
}

/** Resolves the independently materialized adjacent contract, including inverted orders. */
export function resolveIndependentAdjacentContract(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	measurements: LayoutMeasurements,
	options: { readonly maxBranches?: number } = {},
): IndependentAdjacentResolution {
	const budget = options.maxBranches ?? 256;
	if (!Number.isSafeInteger(budget) || budget < 0)
		throw new Error('Layout contract budget must be a non-negative safe integer');
	const built = buildAdjacentLayoutContract(graph, ranks, measurements);
	if (built.status === LayoutContractBuildStatus.Unknown)
		return { status: IndependentAdjacentStatus.Unknown, reason: built.reason, evaluations: [] };
	const { contract } = built;
	const omittedCrossingCandidates = 0;
	const alternatives = contract.candidates.flatMap(candidateFaceBranches);
	const evaluations: IndependentAdjacentEvaluation[] = [];
	let incumbent: IndependentAdjacentSelection | undefined;
	for (const branch of alternatives.slice(0, budget)) {
		const layout = materializeIndependentAdjacentGeometry(
			graph,
			measurements,
			branch.candidate,
			branch.choices,
		);
		if (layout === undefined) {
			evaluations.push({
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.MaterializationFailed,
			});
			continue;
		}
		const checked = validateContractCandidate({
			graph,
			measurements,
			candidate: branch.candidate,
			choices: branch.choices,
			layout,
		});
		if (!checked.valid) {
			evaluations.push({
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.GeometryRejected,
			});
			continue;
		}
		if (hasStrictCrossing(layout)) {
			evaluations.push({
				branchId: branch.id,
				status: IndependentAdjacentBranchStatus.CrossingRejected,
			});
			continue;
		}
		evaluations.push({ branchId: branch.id, status: IndependentAdjacentBranchStatus.Accepted });
		const selection: IndependentAdjacentSelection = {
			candidateId: branch.candidate.id,
			branchId: branch.id,
			choices: branch.choices,
			growth: branch.growth,
			layout,
		};
		if (incumbent === undefined || better(selection, incumbent)) incumbent = selection;
	}
	const trace: SearchTrace = {
		contract,
		scope: contract.shape,
		globalStatus: IndependentAdjacentGlobalStatus.Undetermined,
		omittedCrossingCandidates,
		exploredBranches: evaluations.length,
		totalBranches: alternatives.length,
		evaluations,
	};
	if (evaluations.length < alternatives.length) {
		if (incumbent === undefined) return { ...trace, status: IndependentAdjacentStatus.Incomplete };
		return { ...trace, status: IndependentAdjacentStatus.Incomplete, incumbent };
	}
	if (incumbent === undefined)
		return {
			status: IndependentAdjacentStatus.Unknown,
			reason: IndependentAdjacentUnknownReason.NoValidatedCandidate,
			contract,
			evaluations,
		};
	return { ...trace, status: IndependentAdjacentStatus.Selected, selection: incumbent };
}
