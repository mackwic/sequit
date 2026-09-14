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
