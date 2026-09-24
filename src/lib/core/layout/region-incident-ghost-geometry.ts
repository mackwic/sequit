import type { LayoutResult, Point } from './layout-types';
import { orthogonal } from './nested-region-geometry-primitives';
import { pathsTouchWithoutBridge } from './nested-region-leaf-incident-contacts';

function insideCanvas(point: Point, width: number, height: number): boolean {
	if (point.x < 0 || point.x > width) return false;
	return point.y >= 0 && point.y <= height;
}

export function publicGeometryValid(layout: LayoutResult, incident: readonly Point[]): boolean {
	if (!orthogonal(incident)) return false;
	if (incident.some((point) => !insideCanvas(point, layout.width, layout.height))) return false;
	for (const element of layout.elements) {
		const { x, y, width, height } = element.bounds;
		if (!insideCanvas({ x, y }, layout.width, layout.height)) return false;
		if (!insideCanvas({ x: x + width, y: y + height }, layout.width, layout.height)) return false;
	}
	for (const route of layout.relations) {
		if (!orthogonal(route.points)) return false;
		if (route.points.some((point) => !insideCanvas(point, layout.width, layout.height)))
			return false;
		if (pathsTouchWithoutBridge(incident, route.points)) return false;
	}
	return true;
}
