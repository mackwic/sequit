import {
	EndpointKind,
	type LayoutConfiguration,
	type LayoutDirection,
	type LogicDocument,
	type LogicNode,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import type { GroupMeasurement, Size } from '../../../src/lib/core/layout/layout-types';
import type { LayoutMeasurementOverrides } from '../builders/layout-measurements';
import { validLogicDocument } from '../builders/logic-document';
import type { VisualGraphData } from '../builders/visual-graph-builder';
import { mixedBranchAlignment } from './mixed-branch-alignment';

export interface JunctionObstacleMeasurements {
	readonly nodes?: Readonly<Record<string, Size>>;
	readonly junction?: Size;
}

/** X bypasses a physical junction layer without skipping a documentary rank. */
export function junctionObstacle(
	direction: LayoutDirection,
	measurements: JunctionObstacleMeasurements = {},
): VisualGraphData {
	const fixture = mixedBranchAlignment(direction);
	return {
		...fixture,
		nodes: { ...fixture.nodes, ...measurements.nodes },
		junctions: { j: measurements.junction ?? { width: 28, height: 20 } },
		relations: [
			...fixture.relations.filter(({ id }) => id !== 'g-to-s'),
			{ id: 'g-to-j', from: 'g', to: 'j' },
			{ id: 'g-to-q', from: 'g', to: 'q' },
			{ id: 'j-to-s', from: 'j', to: 's' },
		],
	};
}

export interface GroupObstacleMeasurements {
	readonly nodes?: Readonly<Record<string, Size>>;
	readonly group?: GroupMeasurement;
}

/** The group keeps its physical dimensions when the graph direction changes. */
export function wideGroupObstacle(
	layout: LayoutConfiguration,
	measurements: GroupObstacleMeasurements = {},
): { readonly document: LogicDocument; readonly measurements: LayoutMeasurementOverrides } {
	const fixture = mixedBranchAlignment(layout.direction);
	return {
		document: {
			...validLogicDocument(),
			id: 'wide-group-obstacle',
			title: 'Un groupe voisin occupe le passage direct',
			layout,
			groups: [{ kind: EndpointKind.Group, id: 'g', label: 'G', layoutOrder: orderKey('a7') }],
			nodes: Object.keys(fixture.nodes)
				.map((id, index): LogicNode => ({
					kind: EndpointKind.Node,
					id,
					markdown: id.toUpperCase(),
					natureId: 'goal',
					layoutOrder: orderKey(`a${index}`),
				}))
				.filter(({ id }) => id !== 'g'),
			junctions: [],
			relations: fixture.relations,
		},
		measurements: {
			nodes: { ...fixture.nodes, ...measurements.nodes },
			groups: {
				g: measurements.group ?? {
					minimumWidth: 160,
					minimumHeight: 84,
					headerHeight: 36,
					padding: 24,
				},
			},
		},
	};
}
