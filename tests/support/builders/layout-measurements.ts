import type {
	GroupMeasurement,
	LayoutMeasurements,
	Size,
} from '../../../src/app/web/projection/layout-graph';
import type { CanvasMeasurementModel } from '../../../src/app/web/ui/canvas/canvas-model';
import type { LogicDocument } from '../../../src/lib/core/document/logic-document';

export interface LayoutMeasurementOverrides {
	readonly nodes?: Readonly<Record<string, Size>>;
	readonly junctions?: Readonly<Record<string, Size>>;
	readonly groups?: Readonly<Record<string, GroupMeasurement>>;
}

function measurementsForIds(
	nodeIds: readonly string[],
	junctionIds: readonly string[],
	groupIds: readonly string[],
	overrides: LayoutMeasurementOverrides = {},
): LayoutMeasurements {
	return {
		nodes: new Map(nodeIds.map((id) => [id, overrides.nodes?.[id] ?? { width: 220, height: 116 }])),
		junctions: new Map(
			junctionIds.map((id) => [id, overrides.junctions?.[id] ?? { width: 32, height: 32 }]),
		),
		groups: new Map(
			groupIds.map((id) => [
				id,
				overrides.groups?.[id] ?? {
					minimumWidth: 160,
					minimumHeight: 72,
					headerHeight: 36,
					padding: 24,
				},
			]),
		),
	};
}

export function layoutMeasurementsFor(
	document: LogicDocument,
	overrides: LayoutMeasurementOverrides = {},
): LayoutMeasurements {
	return measurementsForIds(
		document.nodes.map(({ id }) => id),
		document.junctions.map(({ id }) => id),
		document.groups.map(({ id }) => id),
		overrides,
	);
}

export function layoutMeasurementsForCanvas(model: CanvasMeasurementModel): LayoutMeasurements {
	return measurementsForIds(
		model.nodes.map(({ id }) => id),
		model.junctions.map(({ id }) => id),
		model.groups.map(({ id }) => id),
	);
}
