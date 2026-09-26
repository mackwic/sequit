import { defined } from '../../../document/logic-document';
import type { LayoutResult, Point } from '../../layout-types';
import { boundaryPortal, type RegionIncidentPath } from '../model/nested-region-recursive-geometry';
import { RegionIncidentRole, type RegionSolvedIncident } from '../model/region-incident-contract';

function sameAxis(first: Point, middle: Point, last: Point): boolean {
	const sameColumn = first.x === middle.x && middle.x === last.x;
	const sameRow = first.y === middle.y && middle.y === last.y;
	return sameColumn || sameRow;
}

function extendToFrame(points: readonly Point[], framePoint: Point): readonly Point[] {
	const last = defined(points.at(-1), 'An incident needs a local portal point.');
	const previous = points.at(-2);
	if (previous !== undefined && sameAxis(previous, last, framePoint))
		return [...points.slice(0, -1), framePoint];
	return [...points, framePoint];
}

/** Add the region frame padding after a policy has solved the local incident. */
export function regionLeafIncidentPath(
	regionId: string,
	layout: LayoutResult,
	incident: RegionSolvedIncident,
): RegionIncidentPath {
	const portal = boundaryPortal({
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		regionId,
		side: incident.side,
		x: incident.portal.x,
		y: incident.portal.y,
		canvasWidth: layout.width,
		canvasHeight: layout.height,
	});
	const fromEndpoint = extendToFrame(incident.points, portal.point);
	let points = fromEndpoint;
	if (incident.role === RegionIncidentRole.Target) points = [...fromEndpoint].reverse();
	return {
		relationId: incident.relationId,
		endpointId: incident.endpointId,
		pieces: [{ relationId: incident.relationId, regionId, points }],
		portals: [portal],
	};
}
