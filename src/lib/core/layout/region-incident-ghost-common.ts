import type { LayoutPolicy, LogicDocument } from '../document/logic-document';
import { createGraph } from '../graph/create-graph';
import type { LayoutMeasurements } from './layout-types';
import type { LayoutElement, LayoutResult, Point } from './layout-types';
import type {
	NestedRegionLocalLayout,
	NestedRegionLocalLayoutCache,
} from './nested-region-local-cache';
import { NestedPortalSide } from './nested-region-types';
import { publicGeometryValid } from './region-incident-ghost-geometry';
import { solveRegionLeafLayout } from './region-leaf-layout';

export enum RegionIncidentGhostStatus {
	Selected = 'selected',
	Unsupported = 'unsupported',
	Unknown = 'unknown',
}

export interface RegionIncidentGhostFailure {
	readonly status: RegionIncidentGhostStatus.Unsupported | RegionIncidentGhostStatus.Unknown;
	readonly reason: string;
}

export interface ProjectionFrame {
	readonly offsetY: number;
	readonly height: number;
}

export function unavailable(
	status: RegionIncidentGhostStatus.Unsupported | RegionIncidentGhostStatus.Unknown,
	reason: string,
): RegionIncidentGhostFailure {
	return { status, reason };
}

/** Validate and solve the augmented leaf through the same cache-aware production pipeline. */
export function solveGhostLeaf(input: {
	readonly document: LogicDocument;
	readonly measurements: LayoutMeasurements;
	readonly policy?: LayoutPolicy | undefined;
	readonly cache?: NestedRegionLocalLayoutCache | undefined;
}): NestedRegionLocalLayout | RegionIncidentGhostFailure {
	const graph = createGraph(input.document);
	if (!graph.ok)
		return unavailable(
			RegionIncidentGhostStatus.Unknown,
			graph.diagnostics.map(({ message }) => message).join('; '),
		);
	return solveRegionLeafLayout(input.document, input.measurements, input.policy, input.cache);
}

export function freshId(base: string, occupied: ReadonlySet<string>): string {
	if (!occupied.has(base)) return base;
	let suffix = 1;
	while (occupied.has(`${base}#${suffix}`)) suffix += 1;
	return `${base}#${suffix}`;
}

export function translatePoint(point: Point, offsetY: number): Point {
	return { x: point.x, y: point.y - offsetY };
}

export function projectionFrame(
	layout: LayoutResult,
	ghost: LayoutElement,
	side: NestedPortalSide,
): ProjectionFrame {
	if (side === NestedPortalSide.Top) {
		const offsetY = ghost.bounds.y + ghost.bounds.height;
		return { offsetY, height: layout.height - offsetY };
	}
	return { offsetY: 0, height: ghost.bounds.y };
}

export function geometryFailure(
	layout: LayoutResult,
	endpoint: LayoutElement,
	points: readonly Point[],
	side: NestedPortalSide,
): string | undefined {
	if (layout.height <= 0) return 'The projected leaf has no height.';
	const anchor = points[0];
	const portal = points.at(-1);
	if (anchor === undefined || portal === undefined)
		return 'The auxiliary route has no incident anchors.';
	let expectedAnchorY = endpoint.bounds.y;
	let expectedPortalY = 0;
	if (side === NestedPortalSide.Bottom) {
		expectedAnchorY += endpoint.bounds.height;
		expectedPortalY = layout.height;
	}
	if (anchor.y !== expectedAnchorY) return 'The auxiliary route uses the wrong node face.';
	if (portal.y !== expectedPortalY) return 'The auxiliary route misses the leaf boundary.';
	if (portal.x <= 0 || portal.x >= layout.width)
		return 'The auxiliary route reaches a leaf corner.';
	if (!publicGeometryValid(layout, points))
		return 'The auxiliary route cannot form an isolated boundary incident.';
	return undefined;
}
