import type { LogicGraph } from '../graph/create-graph';
import type { RouteWorkCharge } from './bridges/bridge-oracle';
import {
	type RegionIncidentContract,
	RegionIncidentRejectionCode,
	type RegionIncidentSearchWitness,
	type RegionSolvedIncident,
} from './region-incident-contract';
import type { SharedLaneGeometry, SharedLaneGeometryCertificate } from './shared-lane-geometry';
import { validateSharedLaneGeometryWithCertificate } from './shared-lane-geometry';
import {
	type IncidentSearchState,
	rejectIncidentAlternative,
	searchLaneIncidentPaths,
	searchWitness,
} from './shared-lane-incident-search';
import type { SharedLanePorts } from './shared-lane-ports';
import type { SharedLaneRouteCertificate } from './shared-lane-route-delta';
import { validateSharedLaneGeometryDelta } from './shared-lane-route-delta';

export interface SharedLaneGeometryAttemptSelection {
	readonly incidents: readonly RegionSolvedIncident[];
	readonly bridges?: number | undefined;
	readonly witness: RegionIncidentSearchWitness;
}

interface SharedLaneGeometryAttemptInput {
	readonly graph: LogicGraph;
	readonly geometry: SharedLaneGeometry;
	readonly ports: SharedLanePorts;
	readonly contracts: readonly RegionIncidentContract[];
	readonly acceptBridges: boolean;
	readonly state: IncidentSearchState;
	readonly certificate: SharedLaneGeometryCertificate;
	readonly routeCertificate?: SharedLaneRouteCertificate;
	readonly changedRouteIds?: ReadonlySet<string>;
	readonly charge?: RouteWorkCharge | undefined;
}

export function attemptSharedLaneGeometry(
	input: SharedLaneGeometryAttemptInput,
): SharedLaneGeometryAttemptSelection | string {
	const {
		graph,
		geometry,
		ports,
		contracts,
		acceptBridges,
		state,
		certificate,
		routeCertificate,
		changedRouteIds,
		charge,
	} = input;
	let bridges: number | undefined;
	let issue: string | undefined;
	if (routeCertificate !== undefined && changedRouteIds !== undefined) {
		issue = validateSharedLaneGeometryDelta({
			graph,
			geometry,
			staticCertificate: certificate,
			routeCertificate,
			changedRouteIds,
			acceptBridges,
			charge,
			onBridgeCount: (count) => {
				bridges = count;
			},
		});
	} else
		issue = validateSharedLaneGeometryWithCertificate(graph, geometry, certificate, acceptBridges);
	if (issue !== undefined) {
		const first = contracts[0];
		const side = first?.allowedSides[0];
		if (first !== undefined && side !== undefined) {
			rejectIncidentAlternative(state, first, side, {
				code: RegionIncidentRejectionCode.GeometryInvalid,
				reason: issue,
			});
		}
		return issue;
	}
	const incidents = searchLaneIncidentPaths({ geometry, ports, contracts, state });
	if (incidents === undefined)
		return state.rejectedAlternatives[0]?.reason ?? 'No lane incident side remains valid.';
	let witness = searchWitness(state);
	if (contracts.length > 0) witness = { ...witness, exhaustive: false };
	return { incidents, witness, bridges };
}
