import { LaneGrowth, type RegionLanePresentation } from '../../core/document/logic-document';
import { mapLanePresentationFields } from './map-lane-presentation-fields';
import { mapLaneTable } from './map-lane-table';
import { type MappingContext, rejectUnknownFields, table } from './map-sequit-fields';

/** Parse a leaf-local lane contract; semantic assignment checks remain in the document validator. */
export function mapRegionLanePresentation(
	value: unknown,
	regionId: string,
	context: MappingContext,
): RegionLanePresentation | undefined {
	const path = ['regionPresentation', 'regions', regionId, 'lanePresentation'];
	const root = table(value, path, context);
	if (root === undefined) return undefined;
	rejectUnknownFields(root, ['laneOrientation', 'growth', 'lanes'], path, {
		context,
		description: 'region lane presentation',
	});
	const { orientation, validGrowth } = mapLanePresentationFields(root, path, context);
	const lanes = mapLaneTable(root['lanes'], [...path, 'lanes'], context, 'region lane');
	if (orientation === undefined) return undefined;
	if (!validGrowth) return undefined;
	if (lanes === undefined) return undefined;
	return { laneOrientation: orientation, growth: LaneGrowth.Auto, lanes };
}
