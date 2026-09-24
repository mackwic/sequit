import {
	LaneGrowth,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutPolicy,
	type RootLayoutPresentation,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { mapLanePresentationFields } from './map-lane-presentation-fields';
import { mapLaneTable } from './map-lane-table';
import { type MappingContext, rejectUnknownFields, string, table } from './map-sequit-fields';

const policyByValue: Readonly<Record<string, LayoutPolicy>> = {
	[LayoutPolicy.Layered]: LayoutPolicy.Layered,
	[LayoutPolicy.SharedLanes]: LayoutPolicy.SharedLanes,
};

function invalidValue(context: MappingContext, message: string, path: readonly string[]): void {
	context.diagnostics.push({ code: SequitDiagnosticCode.InvalidValue, message, path });
}

export function mapPresentation(
	value: unknown,
	context: MappingContext,
	allowSharedPolicy = false,
): RootLayoutPresentation | undefined {
	const path = ['presentation'];
	const root = table(value, path, context);
	if (root === undefined) return undefined;
	rejectUnknownFields(
		root,
		['schemaVersion', 'policy', 'laneOrientation', 'growth', 'lanes'],
		path,
		{ context, description: 'presentation' },
	);
	const validSchema = root['schemaVersion'] === LAYOUT_PRESENTATION_SCHEMA;
	if (!validSchema)
		invalidValue(
			context,
			`Unsupported layout presentation schema: ${String(root['schemaVersion'])}`,
			[...path, 'schemaVersion'],
		);
	const policy = string(root['policy'], [...path, 'policy'], context);
	let mappedPolicy: LayoutPolicy | undefined;
	if (policy !== undefined) mappedPolicy = policyByValue[policy];
	const permittedPolicy = allowSharedPolicy || mappedPolicy === LayoutPolicy.Layered;
	const validPolicy = mappedPolicy !== undefined && permittedPolicy;
	if (policy !== undefined && !validPolicy)
		invalidValue(context, `Unsupported root layout policy: ${policy}`, [...path, 'policy']);
	const { orientation, validGrowth } = mapLanePresentationFields(root, path, context);
	const lanes =
		mapLaneTable(root['lanes'], ['presentation', 'lanes'], context, 'presentation') ?? [];
	const valid = [validSchema, validPolicy, orientation !== undefined, validGrowth].every(Boolean);
	if (!valid || orientation === undefined) return undefined;
	if (mappedPolicy === undefined) return undefined;
	return {
		schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
		policy: mappedPolicy,
		laneOrientation: orientation,
		growth: LaneGrowth.Auto,
		lanes,
	};
}
