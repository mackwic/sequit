import {
	type RegionIncidentContract,
	type RegionIncidentRejectedAlternative,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	RegionIncidentUnknownCode,
	type RegionSolvedIncident,
} from './region-incident-contract';
import { laneIncidentPathCandidates } from './shared-lane-incident-paths';
import { validateSharedLaneIncidentPath } from './shared-lane-incident-validation';
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

interface SideSearchInput {
	readonly search: IncidentSearchInput;
	readonly contract: RegionIncidentContract;
	readonly side: RegionIncidentContract['allowedSides'][number];
	readonly index: number;
	readonly earlier: readonly RegionSolvedIncident[];
	readonly strategy: string;
}

function searchSide(input: SideSearchInput): readonly RegionSolvedIncident[] | undefined {
	const { search, contract, side, index, earlier, strategy } = input;
	const candidates = laneIncidentPathCandidates(search.geometry, search.ports, contract, side);
	for (const candidate of candidates) {
		if (search.state.attempted >= MAX_INCIDENT_ALTERNATIVES) {
			search.state.exhaustive = false;
			return undefined;
		}
		search.state.candidateId = `${strategy}/${candidate.id}`;
		search.state.attempted += 1;
		if ('code' in candidate.path) {
			rejectIncidentAlternative(search.state, contract, side, candidate.path);
			continue;
		}
		const issue = validateSharedLaneIncidentPath(
			search.geometry,
			contract,
			candidate.path,
			earlier,
		);
		if (issue !== undefined) {
			rejectIncidentAlternative(search.state, contract, side, issue);
			continue;
		}
		const selected = searchLaneIncidentPaths(search, index + 1, [...earlier, candidate.path]);
		if (selected !== undefined) return selected;
		if (!search.state.exhaustive) return undefined;
		rejectIncidentAlternative(search.state, contract, side, {
			code: RegionIncidentRejectionCode.RouteObstructed,
			reason: `Incident ${contract.relation.id} has no compatible side assignment with later incidents.`,
		});
	}
	return undefined;
}

/** Bounded depth-first search over declared sides in canonical contract order. */
export function searchLaneIncidentPaths(
	input: IncidentSearchInput,
	index = 0,
	earlier: readonly RegionSolvedIncident[] = [],
): readonly RegionSolvedIncident[] | undefined {
	const contract = input.contracts[index];
	if (contract === undefined) return earlier;
	const strategy = input.state.strategyId;
	for (const side of contract.allowedSides) {
		const selected = searchSide({ search: input, contract, side, index, earlier, strategy });
		if (selected !== undefined) return selected;
		if (!input.state.exhaustive) return undefined;
	}
	input.state.candidateId = strategy;
	return undefined;
}
