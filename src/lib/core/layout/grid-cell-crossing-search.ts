import { defined } from '../document/logic-document';
import { boundedCounter } from './bounded-search';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import {
	type CrossingAllocationPhase,
	crossingAllocationPhases,
	type GridCrossingAllocationBudgets,
	type GridCrossingAllocationSelectedWitness,
	type GridCrossingAllocationWitness,
} from './grid-cell-crossing-phases';
import type { RegionGeometryDiagnostic } from './region-geometry-diagnostic';

export interface GridCrossingRouteAttempt<Candidate> {
	readonly candidate: Candidate;
	readonly failure?: RegionGeometryDiagnostic;
}

interface GridCrossingAllocationSelection<Candidate> {
	readonly candidate: Candidate;
	readonly allocation: GridCrossingAllocation;
}

interface GridCrossingAllocationSearchSelected<Candidate> {
	readonly selected: GridCrossingAllocationSelection<Candidate>;
	readonly witness: GridCrossingAllocationSelectedWitness;
}

interface GridCrossingAllocationSearchFailed {
	readonly failure: RegionGeometryDiagnostic;
	readonly witness: GridCrossingAllocationWitness;
}

export type GridCrossingAllocationSearchResult<Candidate> =
	GridCrossingAllocationSearchSelected<Candidate> | GridCrossingAllocationSearchFailed;

interface GridCrossingAllocationPhaseResult<Candidate> {
	readonly selection: GridCrossingAllocationSelection<Candidate> | undefined;
	readonly failure: RegionGeometryDiagnostic | undefined;
	readonly rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][];
	readonly evidence: GridCrossingAllocationWitness['phases'][number];
}

/** A phase counts only geometries reachable while nonconflicting routes retain their tracks. */
function scopedGeometryCount(
	input: CrossingAllocationInput,
	phase: CrossingAllocationPhase,
	active: ReadonlySet<string>,
): bigint {
	if (active.size === input.crossingIds.length) return phase.totalGeometries(input);
	let count = 0n;
	const iterator = phase.candidates(input, active);
	while (iterator.next().done === false) count += 1n;
	return count;
}

function allocationIdentity(
	allocation: GridCrossingAllocation,
	input: CrossingAllocationInput,
): string {
	const tracks = (values: ReadonlyMap<string, number>, ids: readonly string[]): readonly number[] =>
		ids.map((id) => defined(values.get(id)));
	return JSON.stringify([
		input.gutterIds.map((ids, column) =>
			tracks(defined(allocation.gutterTrackByRelationId[column]), ids),
		),
		tracks(allocation.busTrackByRelationId, input.busRelevantRelationIds),
		[...input.incidence].map(([id, ids]) =>
			tracks(defined(allocation.portTrackByEndpointId.get(id)), ids),
		),
	]);
}

function addConflictingRoutes(
	active: Set<string>,
	input: CrossingAllocationInput,
	failure: RegionGeometryDiagnostic,
): boolean {
	const conflicting = [failure.relationId, failure.relatedRelationId].filter(
		(id): id is string => id !== undefined && input.crossingIds.includes(id),
	);
	if (conflicting.length === 0) conflicting.push(...input.crossingIds);
	let expanded = false;
	for (const id of conflicting) {
		if (active.has(id)) continue;
		active.add(id);
		expanded = true;
	}
	return expanded;
}

function searchGridCrossingPhase<Candidate>(
	input: CrossingAllocationInput,
	phase: CrossingAllocationPhase,
	frontier: { readonly active: Set<string>; readonly prioritizeBus: boolean },
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
): GridCrossingAllocationPhaseResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const explored = boundedCounter(phase.budget);
	const { active, prioritizeBus } = frontier;
	const seen = new Set<string>();
	let iterator = phase.candidates(input, active, prioritizeBus);
	let next = iterator.next();
	while (next.done === false) {
		const allocation = next.value;
		next = iterator.next();
		const key = allocationIdentity(allocation, input);
		if (seen.has(key)) continue;
		if (!explored.take()) break;
		seen.add(key);
		const attempt = route(allocation, phase.acceptBridges);
		if (attempt.failure === undefined) {
			selection = { candidate: attempt.candidate, allocation };
			break;
		}
		failure = attempt.failure;
		rejectedAlternatives.push({
			phaseId: phase.id,
			busOrder: [...allocation.busTrackByRelationId]
				.sort((left, right) => left[1] - right[1])
				.map(([relationId]) => relationId),
			code: attempt.failure.code,
			reason: attempt.failure.message,
		});
		// Each rejection names the routes whose geometry can repair it. A geometry failure
		// without crossing-route provenance cannot be pruned: retain the exhaustive oracle.
		const expanded = addConflictingRoutes(active, input, attempt.failure);
		if (expanded) {
			iterator = phase.candidates(input, active, prioritizeBus);
			next = iterator.next();
		}
	}
	const total = scopedGeometryCount(input, phase, active);
	const exhaustive = BigInt(explored.attempted) === total;
	return {
		selection,
		failure,
		rejectedAlternatives,
		evidence: {
			id: phase.id,
			attempted: true,
			exploredGeometries: explored.attempted,
			totalGeometries: total.toString(),
			exhaustive,
			truncated: selection === undefined && !exhaustive,
			selected: selection !== undefined,
		},
	};
}

export enum GridCrossingSearchMode {
	Conflicts = 'conflicts',
	Exhaustive = 'exhaustive',
}

/** Search each declared grid issue with its own candidate budget and publish phase evidence. */
export function searchGridCrossingAllocations<Candidate>(
	input: CrossingAllocationInput,
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
	budgets?: GridCrossingAllocationBudgets,
	mode: GridCrossingSearchMode = GridCrossingSearchMode.Conflicts,
): GridCrossingAllocationSearchResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let winningPhase: CrossingAllocationPhase['id'] | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const phases = crossingAllocationPhases(input, budgets);
	const phaseEvidence: GridCrossingAllocationWitness['phases'][number][] = [];
	const active = new Set<string>();
	if (mode === GridCrossingSearchMode.Exhaustive)
		for (const id of input.crossingIds) active.add(id);
	for (const phase of phases) {
		// A compact space keeps the established canonical first-valid precedence. Above four
		// phase budgets, only rejected routes contribute permutations to the frontier.
		const compact = phase.totalGeometries(input) <= BigInt(phase.budget) * 4n;
		let phaseActive = active;
		if (mode === GridCrossingSearchMode.Exhaustive || compact)
			phaseActive = new Set(input.crossingIds);
		const result = searchGridCrossingPhase(
			input,
			phase,
			{ active: phaseActive, prioritizeBus: !compact && mode === GridCrossingSearchMode.Conflicts },
			route,
		);
		phaseEvidence.push(result.evidence);
		rejectedAlternatives.push(...result.rejectedAlternatives);
		if (result.failure !== undefined) failure = result.failure;
		if (result.selection === undefined) continue;
		selection = result.selection;
		winningPhase = phase.id;
		break;
	}
	for (const phase of phases.slice(phaseEvidence.length))
		phaseEvidence.push({
			id: phase.id,
			attempted: false,
			exploredGeometries: 0,
			totalGeometries: scopedGeometryCount(input, phase, active).toString(),
			exhaustive: false,
			truncated: false,
			selected: false,
		});
	const witness: GridCrossingAllocationWitness = {
		attempted: phaseEvidence.reduce((sum, phase) => sum + phase.exploredGeometries, 0),
		exhaustive: phaseEvidence.every(({ attempted, exhaustive }) => attempted && exhaustive),
		rejectedAlternatives,
		phases: phaseEvidence,
	};
	if (selection !== undefined && winningPhase !== undefined)
		return { selected: selection, witness: { ...witness, winningPhase } };
	return { failure: defined(failure), witness };
}
