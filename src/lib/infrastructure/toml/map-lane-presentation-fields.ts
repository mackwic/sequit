import {
	LaneGrowth,
	LaneOrientation,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { type MappingContext, string, type UnknownTable } from './map-sequit-fields';

interface MappedLanePresentationFields {
	readonly orientation: LaneOrientation | undefined;
	readonly validGrowth: boolean;
}

/** Root and local lanes share values, while callers retain their own source paths. */
export function mapLanePresentationFields(
	root: UnknownTable,
	path: readonly string[],
	context: MappingContext,
): MappedLanePresentationFields {
	const orientationValue = string(root['laneOrientation'], [...path, 'laneOrientation'], context);
	let orientation: LaneOrientation | undefined;
	if (orientationValue === LaneOrientation.Parallel) orientation = LaneOrientation.Parallel;
	if (orientationValue === LaneOrientation.Transverse) orientation = LaneOrientation.Transverse;
	if (orientationValue !== undefined && orientation === undefined)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported lane orientation: ${orientationValue}`,
			path: [...path, 'laneOrientation'],
		});
	const growth = string(root['growth'], [...path, 'growth'], context);
	const validGrowth = growth === LaneGrowth.Auto;
	if (growth !== undefined && !validGrowth)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: `Unsupported lane growth policy: ${growth}`,
			path: [...path, 'growth'],
		});
	return { orientation, validGrowth };
}
