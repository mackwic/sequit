import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import { envelopeOf } from '../geometry/envelope';
import {
	biasedMainStart,
	boundsOnAxes,
	type LayoutFrame,
	mainSize,
	type MutableBounds,
	translateTransversely,
	transverseSize,
} from '../geometry/layout-frame';
import { COMPONENT_GAP, OUTER_MARGIN } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import type { PackingCursor } from './pack-components';
import { type MainWindow, packGroupSiblings } from './pack-group-siblings';

function enclosure(
	measurement: GroupMeasurement,
	members: readonly string[],
	bounds: ReadonlyMap<string, MutableBounds>,
): MutableBounds {
	const envelope = envelopeOf(members, bounds);
	const x = envelope.left - measurement.padding;
	const y = envelope.top - measurement.headerHeight - measurement.padding;
	return {
		x,
		y,
		width: Math.max(measurement.minimumWidth, envelope.right - x + measurement.padding),
		height: Math.max(measurement.minimumHeight, envelope.bottom - y + measurement.padding),
	};
}

/** Capture minimum-gap spans; a junction may retreat as its adjacent channels grow. */
export function groupSeparationWindows(
	bounds: ReadonlyMap<string, MutableBounds>,
	vertical: boolean,
	junctionSlack: ReadonlyMap<string, number>,
): ReadonlyMap<string, MainWindow> {
	const windows = new Map<string, MainWindow>();
	for (const [id, box] of bounds) {
		let first = box.x;
		if (vertical) first = box.y;
		const slack = junctionSlack.get(id) ?? 0;
		windows.set(id, { first: first - slack, last: first + mainSize(box, vertical) + slack });
	}
	return windows;
}

/**
 * Pack disjoint sibling intervals bottom-up; translate their contents top-down once.
 * Every ancestor sees the effective measured bounds of each child, including tall
 * empty groups. Minimum-gap intervals are fixed before routing grows gaps.
 */
export function separateInterleavedGroupNodes(input: {
	readonly hierarchy: GroupHierarchy;
	readonly graph: LogicGraph;
	readonly measurements: ReadonlyMap<string, GroupMeasurement>;
	readonly bounds: Map<string, MutableBounds>;
	readonly frame: LayoutFrame;
	readonly windows: ReadonlyMap<string, MainWindow>;
}): void {
	const { hierarchy, graph, measurements, bounds, frame, windows } = input;
	const pending = new Map<string, number>();
	for (const group of hierarchy.deepestFirst) {
		const children = hierarchy.membersById.get(group.id) ?? [];
		if (children.length === 0) continue;
		packGroupSiblings(
			children,
			bounds,
			{ groupIds: hierarchy.byId, pending, windows },
			frame.vertical,
		);
		bounds.set(group.id, enclosure(defined(measurements.get(group.id)), children, bounds));
	}
	const roots = [
		...graph.document.nodes.filter((node) => node.groupId === undefined).map((node) => node.id),
		...graph.document.junctions
			.filter((junction) => junction.groupId === undefined)
			.map((junction) => junction.id),
		...graph.document.groups
			.filter((group) => group.groupId === undefined)
			.map((group) => group.id),
	];
	packGroupSiblings(roots, bounds, { groupIds: hierarchy.byId, pending, windows }, frame.vertical);

	// Parent translations have already moved the child frame, not its contents.
	const queue = graph.document.groups
		.filter((group) => group.groupId === undefined)
		.map((group) => ({ id: group.id, inherited: 0 }));
	for (const { id, inherited } of queue) {
		const childShift = inherited + (pending.get(id) ?? 0);
		if (inherited !== 0) translateTransversely(defined(bounds.get(id)), inherited, frame.vertical);
		for (const memberId of hierarchy.membersById.get(id) ?? []) {
			if (hierarchy.byId.has(memberId)) {
				queue.push({ id: memberId, inherited: childShift });
			} else if (childShift !== 0) {
				translateTransversely(defined(bounds.get(memberId)), childShift, frame.vertical);
			}
		}
	}
}

export function encloseGroups(
	input: {
		readonly hierarchy: GroupHierarchy;
		readonly measurements: ReadonlyMap<string, GroupMeasurement>;
		readonly bounds: Map<string, MutableBounds>;
		readonly frame: LayoutFrame;
	},
	cursor: PackingCursor,
): void {
	const { hierarchy, measurements, bounds, frame } = input;
	for (const group of hierarchy.deepestFirst) {
		const measurement = defined(measurements.get(group.id));
		const members = hierarchy.membersById.get(group.id) ?? [];
		if (members.length > 0) {
			bounds.set(group.id, enclosure(measurement, members, bounds));
			continue;
		}
		if (bounds.has(group.id)) continue;
		const size = { width: measurement.minimumWidth, height: measurement.minimumHeight };
		const main =
			OUTER_MARGIN +
			biasedMainStart(mainSize(size, frame.vertical), cursor.maximumPrimaryLength, frame);
		bounds.set(group.id, boundsOnAxes(cursor.cross, main, size, frame.vertical));
		cursor.cross += transverseSize(size, frame.vertical) + COMPONENT_GAP;
	}
}
