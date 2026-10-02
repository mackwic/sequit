import {
	LaneOrientation,
	type LayoutDirection,
	type LayoutLane,
	type LogicDocument,
} from '../../../../lib/core/document/logic-document';
import { isVerticalDirection } from '../../../../lib/core/layout/geometry/layout-frame';
import { orderedLaneIds } from '../../../../lib/core/layout/lanes/shared-lane-model';
import { m } from '../../i18n/paraglide/messages';

/** The root lanes in reading order, as the engine orders them; empty without explicit lanes. */
export function rootLanes(document: LogicDocument): readonly LayoutLane[] {
	const presentation = document.presentation;
	if (presentation === undefined) return [];
	return orderedLaneIds(document).flatMap((laneId) =>
		presentation.lanes.filter(({ id }) => id === laneId),
	);
}

/** The first shared lane policy of the engine (`shared-lane-model.ts`) stops at three lanes. */
export const MAX_ROOT_LANES = 3;

/** Junctions and groups with members are outside that policy: the layout would only diagnose. */
export function unsupportedByRootLanes(document: LogicDocument): boolean {
	return (
		document.junctions.length > 0 ||
		document.nodes.some(({ groupId }) => groupId !== undefined) ||
		document.groups.some(({ groupId }) => groupId !== undefined)
	);
}

/**
 * Lanes run along the main axis (parallel) or across it (transverse); what the author sees is
 * columns or bands, which depends on the direction.
 */
export function laneOrientationLabel(
	orientation: LaneOrientation,
	direction: LayoutDirection,
): string {
	const along = orientation === LaneOrientation.Parallel;
	if (along === isVerticalDirection(direction)) return m.canvas_lane_columns();
	return m.canvas_lane_bands();
}
