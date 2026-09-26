import type { EndpointRoute } from './bridge-contact';
import { RegionIncidentRole, type RegionSolvedIncident } from './region-incident-contract';

/** A leaf piece declares only the endpoint actually attached inside this leaf. */
export function incidentEndpointRoute(path: RegionSolvedIncident): EndpointRoute {
	const route: { id: string; points: RegionSolvedIncident['points']; from?: string; to?: string } =
		{
			id: path.relationId,
			points: path.points,
		};
	if (path.role === RegionIncidentRole.Source) route.from = path.endpointId;
	else route.to = path.endpointId;
	return route;
}
