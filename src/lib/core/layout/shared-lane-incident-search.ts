import { defined } from '../document/logic-document';
import {
	type RegionIncidentContract,
	type RegionIncidentRejectedAlternative,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from './region-incident-contract';
import { boundedCounter, firstValidDepthFirst } from './search/bounded-search';
import {
	type LaneIncidentPathCandidate,
	laneIncidentPathCandidates,
} from './shared-lane-incident-paths';
import {
	type SharedLaneIncidentFailure,
	validateSharedLaneIncidentPath,
} from './shared-lane-incident-validation';
import type { SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneGeometry } from './shared-lane-types';

const MAX_INCIDENT_ALTERNATIVES = 256;

export interface IncidentSearchState {
	attempted: number;
	exhaustive: boolean;
	strategyId: string;
	candidateId: string;
	readonly rejectedAlternatives: RegionIncidentRejectedAlternative[];
}

export function searchWitness(state: IncidentSearchState): RegionIncidentSearchWitness {
	return {
		attempted: state.attempted,
		exhaustive: state.exhaustive,
		rejectedAlternatives: [...state.rejectedAlternatives],
	};
}

export function unknownCode(state: IncidentSearchState): RegionIncidentUnknownCode {
	if (state.exhaustive) return RegionIncidentUnknownCode.NoValidAlternative;
	return RegionIncidentUnknownCode.SearchBudgetExceeded;
}

export function rejectIncidentAlternative(
	state: IncidentSearchState,
	contract: RegionIncidentContract,
	side: RegionIncidentContract['allowedSides'][number],
	issue: { readonly code: RegionIncidentRejectionCode; readonly reason: string },
): void {
	state.rejectedAlternatives.push({
		candidateId: state.candidateId,
		relationId: contract.relation.id,
		endpointId: contract.endpointId,
		role: contract.role,
		side,
		code: issue.code,
		reason: issue.reason,
	});
}

interface IncidentSearchInput {
	readonly geometry: SharedLaneGeometry;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly state: IncidentSearchState;
}

/** One candidate of the declared side order, with the side it was materialized for. */
interface LaneIncidentChoice {
	readonly side: RegionIncidentContract['allowedSides'][number];
	readonly candidate: LaneIncidentPathCandidate;
}

/** Every declared side in canonical order, each with its bounded route candidates. */
function* laneIncidentChoices(
	geometry: SharedLaneGeometry,
	ports: SharedLanePorts,
	contract: RegionIncidentContract,
): Generator<LaneIncidentChoice> {
	for (const side of contract.allowedSides)
		for (const candidate of laneIncidentPathCandidates(geometry, ports, contract, side))
			yield { side, candidate };
}

/** Bounded depth-first search over declared sides in canonical contract order. */
export function searchLaneIncidentPaths(
	input: IncidentSearchInput,
): readonly RegionSolvedIncident[] | undefined {
	const { geometry, ports, contracts, state } = input;
	const budget = boundedCounter(MAX_INCIDENT_ALTERNATIVES, {
		attempted: state.attempted,
		exhausted: !state.exhaustive,
	});
	const earlier: RegionSolvedIncident[] = [];
	const found = firstValidDepthFirst<LaneIncidentChoice, SharedLaneIncidentFailure>({
		levels: contracts.length,
		counter: budget,
		choices: (level) => laneIncidentChoices(geometry, ports, defined(contracts[level])),
		accept: (level, choice) => {
			const contract = defined(contracts[level]);
			state.candidateId = `${state.strategyId}/${choice.candidate.id}`;
			if ('code' in choice.candidate.path) return choice.candidate.path;
			const issue = validateSharedLaneIncidentPath(
				geometry,
				contract,
				choice.candidate.path,
				earlier,
			);
			if (issue !== undefined) return issue;
			earlier.push(choice.candidate.path);
			return undefined;
		},
		onReject: (level, choice, rejection) => {
			rejectIncidentAlternative(state, defined(contracts[level]), choice.side, rejection);
		},
		onBacktrack: (level, choice) => {
			earlier.pop();
			rejectIncidentAlternative(state, defined(contracts[level]), choice.side, {
				code: RegionIncidentRejectionCode.RouteObstructed,
				reason: `Incident ${defined(contracts[level]).relation.id} has no compatible side assignment with later incidents.`,
			});
		},
		onExhausted: () => {
			state.candidateId = state.strategyId;
		},
	});
	state.attempted = budget.attempted;
	state.exhaustive = !budget.exhausted;
	if (found.selected === undefined) return undefined;
	return earlier;
}
