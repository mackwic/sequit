import { PORT_INSET, PORT_SPACING } from './layout-settings';
import type { LayoutRelation, Point } from './layout-types';
import { pathsTouchWithoutBridge } from './nested-region-leaf-incident-contacts';
import { hitsBox } from './shared-lane-geometry-primitives';
import type { SharedLaneOutgoingIncident } from './shared-lane-incident-contract';
import type { SharedLaneGeometry } from './shared-lane-types';

const INCIDENT_CLEARANCE = 12;

function localPort(route: LayoutRelation, endpointId: string): Point | undefined {
	if (route.from === endpointId) return route.points[0];
	if (route.to === endpointId) return route.points.at(-1);
	return undefined;
}

/** Prove an unbridged, rightward passage from the reserved node port to the leaf edge. */
export function validateSharedLaneOutgoingIncident(
	layout: SharedLaneGeometry,
	incident: SharedLaneOutgoingIncident,
): string | undefined {
	const source = layout.elements.find(({ id }) => id === incident.endpointId);
	if (source === undefined) return `Incident ${incident.relationId} has no local source node.`;
	const { x, y, width, height } = source.bounds;
	const anchor = { x: x + width, y: y + height / 2 };
	const minimumHeight = 2 * PORT_INSET;
	if (height < minimumHeight || anchor.x >= layout.width)
		return `Incident ${incident.relationId} has no right-facing port capacity.`;
	const edge = { x: layout.width, y: anchor.y };
	const corridor = [anchor, edge];
	for (const other of layout.elements) {
		if (other.id === incident.endpointId) continue;
		if (hitsBox(anchor, edge, other.bounds, INCIDENT_CLEARANCE))
			return `Incident ${incident.relationId} crosses node ${other.id} in its lane leaf.`;
	}
	for (const route of layout.relations) {
		const port = localPort(route, incident.endpointId);
		let gap = Infinity;
		if (port !== undefined) gap = Math.abs(port.y - anchor.y);
		if (port?.x === anchor.x && gap < PORT_SPACING)
			return `Incident ${incident.relationId} has insufficient face capacity beside ${route.id}.`;
		if (pathsTouchWithoutBridge(corridor, route.points))
			return `Incident ${incident.relationId} touches local relation ${route.id} in its lane leaf.`;
	}
	return undefined;
}
