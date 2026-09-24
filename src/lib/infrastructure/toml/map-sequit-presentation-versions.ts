import {
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	LANE_PERSISTENCE_FORMAT,
	type LogicDocument,
	PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
	REGION_LANE_PERSISTENCE_FORMAT,
	REGION_LANE_PRESENTATION_SCHEMA,
	REGION_PERSISTENCE_FORMAT,
	REGION_POLICY_PERSISTENCE_FORMAT,
	REGION_POLICY_PRESENTATION_SCHEMA,
	REGION_PRESENTATION_SCHEMA,
	type RegionLayoutPresentation,
	type RootLayoutPresentation,
	SequitDiagnosticCode,
} from '../../core/document/logic-document';
import { mapPresentation } from './map-layout-presentation';
import { mapRegionPresentation } from './map-region-presentation';
import type { MappingContext, UnknownTable } from './map-sequit-fields';

export function isRegionFormat(format: unknown): boolean {
	if (format === REGION_PERSISTENCE_FORMAT) return true;
	if (format === GRID_PERSISTENCE_FORMAT) return true;
	if (format === REGION_LANE_PERSISTENCE_FORMAT) return true;
	if (format === REGION_COMPOSITION_PERSISTENCE_FORMAT) return true;
	return format === REGION_POLICY_PERSISTENCE_FORMAT;
}

export function mapVersionedPresentation(
	root: UnknownTable,
	format: unknown,
	context: MappingContext,
): RootLayoutPresentation | undefined {
	if (format === LANE_PERSISTENCE_FORMAT) return mapPresentation(root['presentation'], context);
	if (isRegionFormat(format)) {
		if (root['presentation'] === undefined) return undefined;
		return mapPresentation(
			root['presentation'],
			context,
			format === REGION_POLICY_PERSISTENCE_FORMAT,
		);
	}
	if (root['presentation'] !== undefined)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: 'Legacy documents cannot persist explicit lanes',
			path: ['presentation'],
		});
	return undefined;
}

export function mapVersionedRegionPresentation(
	root: UnknownTable,
	format: unknown,
	context: MappingContext,
): RegionLayoutPresentation | undefined {
	if (format === REGION_PERSISTENCE_FORMAT)
		return mapRegionPresentation(root['regionPresentation'], context, REGION_PRESENTATION_SCHEMA);
	if (format === GRID_PERSISTENCE_FORMAT)
		return mapRegionPresentation(
			root['regionPresentation'],
			context,
			GRID_REGION_PRESENTATION_SCHEMA,
		);
	if (format === REGION_LANE_PERSISTENCE_FORMAT)
		return mapRegionPresentation(
			root['regionPresentation'],
			context,
			REGION_LANE_PRESENTATION_SCHEMA,
		);
	if (format === REGION_COMPOSITION_PERSISTENCE_FORMAT)
		return mapRegionPresentation(
			root['regionPresentation'],
			context,
			REGION_COMPOSITION_PRESENTATION_SCHEMA,
		);
	if (format === REGION_POLICY_PERSISTENCE_FORMAT)
		return mapRegionPresentation(
			root['regionPresentation'],
			context,
			REGION_POLICY_PRESENTATION_SCHEMA,
		);
	if (root['regionPresentation'] !== undefined)
		context.diagnostics.push({
			code: SequitDiagnosticCode.InvalidValue,
			message: 'This format cannot persist explicit regions',
			path: ['regionPresentation'],
		});
	return undefined;
}

export function supportedPersistenceFormat(
	format: unknown,
): format is LogicDocument['persistenceFormat'] {
	if (format === PERSISTENCE_FORMAT || format === LANE_PERSISTENCE_FORMAT) return true;
	return isRegionFormat(format);
}
