import type { LayoutLane } from '../../core/document/logic-document';
import {
	entries,
	type MappingContext,
	rejectUnknownFields,
	requiredLayoutOrder,
	string,
	table,
} from './map-sequit-fields';

/** Map a root or region-local lane table while retaining its caller's diagnostic path. */
export function mapLaneTable(
	value: unknown,
	path: readonly string[],
	context: MappingContext,
	description: string,
): readonly LayoutLane[] | undefined {
	const laneTable = table(value, path, context);
	if (laneTable === undefined) return undefined;
	const lanes: LayoutLane[] = [];
	for (const [id, rawLane] of entries(laneTable)) {
		const lanePath = [...path, id];
		const lane = table(rawLane, lanePath, context);
		if (lane === undefined) continue;
		rejectUnknownFields(lane, ['label', 'layoutOrder'], lanePath, {
			context,
			description,
		});
		const label = string(lane['label'], [...lanePath, 'label'], context);
		const layoutOrder = requiredLayoutOrder(
			lane['layoutOrder'],
			[...lanePath, 'layoutOrder'],
			context,
		);
		if (label !== undefined && layoutOrder !== undefined) lanes.push({ id, label, layoutOrder });
	}
	return lanes;
}
