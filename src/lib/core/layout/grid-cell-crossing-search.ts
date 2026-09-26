import { defined } from '../document/logic-document';
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

function searchGridCrossingPhase<Candidate>(
	input: CrossingAllocationInput,
	phase: CrossingAllocationPhase,
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
): GridCrossingAllocationPhaseResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	let explored = 0;
	const total = phase.totalGeometries(input);
	let exhaustive = total === 0n;
	const iterator = phase.candidates(input)[Symbol.iterator]();
	// The exact phase total makes the final boundary observable without pulling one item
	// beyond the budget from a lazy candidate generator.
	while (explored < phase.budget && BigInt(explored) < total) {
		const allocation = defined(iterator.next().value);
		explored += 1;
		const attempt = route(allocation, phase.acceptBridges);
		if (attempt.failure === undefined) {
			selection = { candidate: attempt.candidate, allocation };
			exhaustive = BigInt(explored) === total;
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
		if (BigInt(explored) === total) exhaustive = true;
	}
	return {
		selection,
		failure,
		rejectedAlternatives,
		evidence: {
			id: phase.id,
			attempted: true,
			exploredGeometries: explored,
			totalGeometries: total.toString(),
			exhaustive,
			truncated: selection === undefined && !exhaustive,
			selected: selection !== undefined,
		},
	};
}

/** Search each declared grid issue with its own candidate budget and publish phase evidence. */
export function searchGridCrossingAllocations<Candidate>(
	input: CrossingAllocationInput,
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
	budgets?: GridCrossingAllocationBudgets,
): GridCrossingAllocationSearchResult<Candidate> {
	let selection: GridCrossingAllocationSelection<Candidate> | undefined;
	let winningPhase: CrossingAllocationPhase['id'] | undefined;
	let failure: RegionGeometryDiagnostic | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const phases = crossingAllocationPhases(input, budgets);
	const phaseEvidence: GridCrossingAllocationWitness['phases'][number][] = [];
	for (const phase of phases) {
		const result = searchGridCrossingPhase(input, phase, route);
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
			totalGeometries: phase.totalGeometries(input).toString(),
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
