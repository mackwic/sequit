import type { LogicDocument } from '../../../document/logic-document';
import type { GroupMeasurement, LayoutMeasurements, Size } from '../../layout-types';

/** Preserve only measurements owned by a local region graph. */
export function nestedRegionLocalMeasurements(
	document: LogicDocument,
	all: LayoutMeasurements,
): LayoutMeasurements {
	const nodes = new Map<string, Size>();
	const groups = new Map<string, GroupMeasurement>();
	const junctions = new Map<string, Size>();
	for (const { id } of document.nodes) {
		const size = all.nodes.get(id);
		if (size !== undefined) nodes.set(id, size);
	}
	for (const { id } of document.groups) {
		const size = all.groups.get(id);
		if (size !== undefined) groups.set(id, size);
	}
	for (const { id } of document.junctions) {
		const size = all.junctions.get(id);
		if (size !== undefined) junctions.set(id, size);
	}
	return {
		nodes,
		groups,
		junctions,
	};
}
