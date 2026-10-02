import { defined } from '../../document/logic-document';
import {
	biasedMainStart,
	boundsOnAxes,
	type LayoutFrame,
	mainSize,
	mainStart,
	type MutableBounds,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { COMPONENT_GAP, OUTER_MARGIN } from '../layout-settings';
import type { GroupMeasurement } from '../layout-types';
import type { GroupHierarchy } from '../structure/group-hierarchy';
import {
	freeGroups,
	freeHolders,
	freeMembers,
	heldFreeGroups,
	placeFreeBeside,
	placeFreeGroup,
} from './free-groups';
import { enclosure } from './group-enclosure';
import type { PackingCursor } from './pack-components';

/**
 * Frame every group around its members. A related group holding only free groups places them
 * in its own row slot; any other group not free places its free members beside its content.
 * Free groups holding nothing placed stand after the packed components.
 */
export function encloseGroups(
	input: {
		readonly hierarchy: GroupHierarchy;
		readonly ranks: ReadonlyMap<string, number>;
		readonly measurements: ReadonlyMap<string, GroupMeasurement>;
		readonly bounds: Map<string, MutableBounds>;
		readonly frame: LayoutFrame;
	},
	cursor: PackingCursor,
): void {
	const { hierarchy, measurements, bounds, frame } = input;
	const { vertical } = frame;
	const placement = {
		hierarchy,
		groups: (id: string) => defined(measurements.get(id)),
		bounds,
		vertical,
	};
	for (const id of freeHolders(hierarchy, input.ranks)) {
		const slot = defined(bounds.get(id));
		placeFreeGroup(placement, id, {
			cross: transverseStart(slot, vertical),
			main: mainStart(slot, vertical),
		});
	}
	const free = freeGroups(hierarchy, input.ranks);
	const held = heldFreeGroups(hierarchy, free);
	for (const group of hierarchy.deepestFirst) {
		if (held.has(group.id)) continue;
		const measurement = defined(measurements.get(group.id));
		const members = hierarchy.membersById.get(group.id) ?? [];
		if (members.length > 0) {
			const loose = freeMembers(hierarchy, held, group.id).filter((id) => !bounds.has(id));
			const content = members.filter((id) => !free.has(id));
			if (loose.length > 0) placeFreeBeside(placement, loose, content);
			bounds.set(group.id, enclosure(measurement, members, bounds));
			continue;
		}
		if (bounds.has(group.id)) continue;
		const size = { width: measurement.minimumWidth, height: measurement.minimumHeight };
		const main =
			OUTER_MARGIN + biasedMainStart(mainSize(size, vertical), cursor.maximumPrimaryLength, frame);
		bounds.set(group.id, boundsOnAxes(cursor.cross, main, size, vertical));
		cursor.cross += transverseSize(size, vertical) + COMPONENT_GAP;
	}
}
