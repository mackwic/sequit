import type { PresencePoint } from '../../../../../lib/infrastructure/collaboration/participant-presence';
import {
	SharedElementKind,
	type SharedTarget,
} from '../../../../../lib/infrastructure/document/shared-document-command';
import { EntityKind, type EntityRef } from '../../canvas/canvas-entity';

export interface CanvasAwarenessFrame {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

export interface ViewportSize {
	readonly width: number;
	readonly height: number;
}

/** Where a chip stands for a pointer outside the viewport, and where it points. */
export interface EdgeIndicator {
	readonly x: number;
	readonly y: number;
	/** Degrees, clockwise from "pointing right". */
	readonly angle: number;
}

const TARGET_KIND = {
	[EntityKind.Node]: SharedElementKind.Node,
	[EntityKind.Group]: SharedElementKind.Group,
	[EntityKind.Junction]: SharedElementKind.Junction,
	[EntityKind.Relation]: SharedElementKind.Relation,
};

export function sharedSelection(selection: Iterable<EntityRef>): SharedTarget[] {
	return [...selection].map(({ kind, id }) => ({ kind: TARGET_KIND[kind], id }));
}

export function documentPointer(point: PresencePoint, frame: CanvasAwarenessFrame): PresencePoint {
	return { x: (point.x - frame.x) / frame.zoom, y: (point.y - frame.y) / frame.zoom };
}

export function viewportPointer(point: PresencePoint, frame: CanvasAwarenessFrame): PresencePoint {
	return { x: point.x * frame.zoom + frame.x, y: point.y * frame.zoom + frame.y };
}

/** A viewport-space point outside the visible area, by any distance. */
export function isOutsideViewport(point: PresencePoint, size: ViewportSize): boolean {
	if (point.x < 0 || point.y < 0) return true;
	return point.x > size.width || point.y > size.height;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Pins an off-screen pointer to the nearest edge, `margin` inside, facing the pointer. */
export function edgeIndicator(
	point: PresencePoint,
	size: ViewportSize,
	margin: number,
): EdgeIndicator {
	const x = clamp(point.x, margin, size.width - margin);
	const y = clamp(point.y, margin, size.height - margin);
	const radians = Math.atan2(point.y - y, point.x - x);
	const angle = (radians * 180) / Math.PI;
	return { x, y, angle };
}
