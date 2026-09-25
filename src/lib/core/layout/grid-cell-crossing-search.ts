import { boundedCounter, firstValidDepthFirst, scopedCounter } from './bounded-search';
import type {
	CrossingAllocationInput,
	GridCrossingAllocation,
} from './grid-cell-crossing-allocation';
import {
	type CrossingAllocationPhase,
	crossingAllocationPhases,
	type GridCrossingAllocationWitness,
} from './grid-cell-crossing-phases';
import type { RegionGeometryDiagnostic } from './region-geometry-diagnostic';

export interface GridCrossingRouteAttempt<Candidate> {
	readonly candidate: Candidate;
	readonly failure?: RegionGeometryDiagnostic;
}

export interface GridCrossingAllocationSelection<Candidate> {
	readonly candidate: Candidate;
	readonly allocation: GridCrossingAllocation;
}

export interface GridCrossingAllocationSearchResult<Candidate> {
	readonly selected?: GridCrossingAllocationSelection<Candidate>;
	readonly witness: GridCrossingAllocationWitness;
}

/** Search each declared grid issue with its own candidate budget and publish phase evidence. */
export function searchGridCrossingAllocations<Candidate>(
	input: CrossingAllocationInput,
	route: (
		allocation: GridCrossingAllocation,
		acceptBridges: boolean,
	) => GridCrossingRouteAttempt<Candidate>,
): GridCrossingAllocationSearchResult<Candidate> {
	let selected: GridCrossingAllocationSelection<Candidate> | undefined;
	const rejectedAlternatives: GridCrossingAllocationWitness['rejectedAlternatives'][number][] = [];
	const phases = crossingAllocationPhases(input);
	const totalBudget = phases.reduce((sum, phase) => sum + phase.budget, 0);
	const overallCounter = boundedCounter(totalBudget);
	const phaseEvidence: GridCrossingAllocationWitness['phases'][number][] = [];
	let winningPhase: CrossingAllocationPhase['id'] | undefined;
	for (const phase of phases) {
		const evidence = { attempted: 0, exhausted: false };
		let candidate: Candidate | undefined;
		const counter = scopedCounter(overallCounter, phase.budget, evidence);
		// First-valid preserves issue and candidate priority; best-within-budget would keep
		// evaluating after a valid incumbent even though later alternatives cannot win.
		const result = firstValidDepthFirst<GridCrossingAllocation, RegionGeometryDiagnostic>({
			levels: 1,
			counter,
			// The declared list is the only level: the search evaluates it in order.
			choices: () => phase.candidates(input),
			accept: (_, allocation) => {
				const attempt = route(allocation, phase.acceptBridges);
				if (attempt.failure === undefined) candidate = attempt.candidate;
				return attempt.failure;
			},
			onReject: (_, allocation, diagnostic) =>
				rejectedAlternatives.push({
					phaseId: phase.id,
					busOrder: [...allocation.busTrackByRelationId]
						.sort((left, right) => left[1] - right[1])
						.map(([relationId]) => relationId),
					code: diagnostic.code,
					reason: diagnostic.message,
				}),
		});
		const total = phase.total(input);
		phaseEvidence.push({
			id: phase.id,
			attempted: true,
			explored: evidence.attempted,
			total: total.toString(),
			exhaustive: BigInt(evidence.attempted) === total,
			truncated: !result.exhaustive,
			selected: result.selected !== undefined,
		});
		const allocation = result.selected?.[0];
		if (candidate !== undefined && allocation !== undefined) {
			winningPhase = phase.id;
			selected = { candidate, allocation };
			break;
		}
	}
	for (const phase of phases.slice(phaseEvidence.length))
		phaseEvidence.push({
			id: phase.id,
			attempted: false,
			explored: 0,
			total: phase.total(input).toString(),
			exhaustive: false,
			truncated: false,
			selected: false,
		});
	const witness: GridCrossingAllocationWitness = {
		attempted: overallCounter.attempted,
		exhaustive: phaseEvidence.every(({ attempted, exhaustive }) => attempted && exhaustive),
		rejectedAlternatives,
		phases: phaseEvidence,
	};
	if (winningPhase !== undefined) return { selected, witness: { ...witness, winningPhase } };
	return { selected, witness };
}
