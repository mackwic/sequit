import { compareCanonicalStrings } from '../../core/canonical-string';
import {
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../core/document/logic-document';
import { BusinessCommandRefusal } from '../collaboration/session-failure';
import { CommandRefusalCode } from '../collaboration/session-reasons';
import type { SharedRootLanes } from './shared-document-command';

interface LaneOwner {
	groupId?: string;
	laneId?: string;
}

function withoutLane<T extends LaneOwner>(item: T): T {
	const result = { ...item };
	delete result.laneId;
	return result;
}

function checkedLanes(lanes: SharedRootLanes): ReadonlySet<string> {
	if (lanes.lanes.length < 2)
		throw new BusinessCommandRefusal({ code: CommandRefusalCode.MinimumLanes });
	const ids = new Set<string>();
	for (const lane of lanes.lanes) {
		if (lane.id.trim() === '' || ids.has(lane.id))
			throw new BusinessCommandRefusal({
				code: CommandRefusalCode.InvalidLaneId,
				laneId: lane.id,
			});
		if (lane.label.trim() === '')
			throw new BusinessCommandRefusal({ code: CommandRefusalCode.LaneNameRequired });
		ids.add(lane.id);
	}
	return ids;
}

/**
 * Root lanes only: a document arranged by regions settles its lanes per region. A top-level
 * element keeps its lane when it survives; otherwise it follows `transfers` or joins the first
 * lane. Group members always inherit their group's lane.
 */
export function updateDocumentRootLanes(
	document: LogicDocument,
	lanes: SharedRootLanes | undefined,
	transfers: Readonly<Record<string, string>> = {},
): LogicDocument {
	const format = document.persistenceFormat;
	if (format !== PERSISTENCE_FORMAT && format !== LANE_PERSISTENCE_FORMAT)
		throw new BusinessCommandRefusal({ code: CommandRefusalCode.RegionalLanesRequired });
	if (lanes === undefined) {
		const result = {
			...document,
			persistenceFormat: PERSISTENCE_FORMAT,
			groups: document.groups.map(withoutLane),
			nodes: document.nodes.map(withoutLane),
			junctions: document.junctions.map(withoutLane),
		};
		delete result.presentation;
		return result;
	}
	const ids = checkedLanes(lanes);
	for (const target of Object.values(transfers))
		if (!ids.has(target))
			throw new BusinessCommandRefusal({
				code: CommandRefusalCode.UnknownDestinationLane,
				target,
			});
	const [first] = [...lanes.lanes].sort(
		(left, right) =>
			compareCanonicalStrings(left.layoutOrder, right.layoutOrder) ||
			compareCanonicalStrings(left.id, right.id),
	);
	if (first === undefined)
		throw new BusinessCommandRefusal({ code: CommandRefusalCode.MinimumLanes });
	const assign = <T extends LaneOwner>(item: T): T => {
		if (item.groupId !== undefined) return withoutLane(item);
		if (item.laneId !== undefined && ids.has(item.laneId)) return item;
		return { ...item, laneId: transfers[item.laneId ?? ''] ?? first.id };
	};
	return {
		...document,
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: lanes.laneOrientation,
			growth: LaneGrowth.Auto,
			lanes: lanes.lanes,
		},
		groups: document.groups.map(assign),
		nodes: document.nodes.map(assign),
		junctions: document.junctions.map(assign),
	};
}
