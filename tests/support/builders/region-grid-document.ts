import {
	LaneGrowth,
	LaneOrientation,
	LayoutPolicy,
	type LogicDocument,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
	REGION_COMPOSITION_PRESENTATION_SCHEMA,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import { validLogicDocument } from './logic-document';

/** A grid below the virtual root, with an ordinary sibling and lanes in one cell. */
export function regionGridDocument(): LogicDocument {
	const source = validLogicDocument();
	return {
		...source,
		persistenceFormat: REGION_COMPOSITION_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: REGION_COMPOSITION_PRESENTATION_SCHEMA,
			regions: [
				{
					id: 'branch',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
					grid: {
						minimumColumnWidths: [700, 100],
						minimumRowHeights: [50, 300],
						cells: [
							{ regionId: 'a', row: 0, column: 0 },
							{ regionId: 'b', row: 0, column: 1 },
							{ regionId: 'c', row: 1, column: 0 },
							{ regionId: 'd', row: 1, column: 1 },
						],
					},
				},
				{
					id: 'ordinary',
					layoutOrder: orderKey('a1'),
					policy: LayoutPolicy.Layered,
				},
				{
					id: 'a',
					parentId: 'branch',
					layoutOrder: orderKey('a0'),
					policy: LayoutPolicy.Layered,
					lanePresentation: {
						laneOrientation: LaneOrientation.Parallel,
						growth: LaneGrowth.Auto,
						lanes: [
							{ id: 'left', label: 'Left', layoutOrder: orderKey('a0') },
							{ id: 'right', label: 'Right', layoutOrder: orderKey('a1') },
						],
					},
				},
				...['b', 'c', 'd'].map((id, index) => ({
					id,
					parentId: 'branch',
					layoutOrder: orderKey(`a${index + 1}`),
					policy: LayoutPolicy.Layered,
				})),
			],
		},
		groups: source.groups.map((group) => {
			if (group.id === 'container') return { ...group, regionId: 'a', laneId: 'left' };
			if (group.id === 'endpoint-group') return { ...group, regionId: 'ordinary' };
			return group;
		}),
		nodes: source.nodes.map((node) => {
			if (node.id === 'target') return { ...node, regionId: 'd' };
			if (node.id === 'isolated') return { ...node, regionId: 'ordinary' };
			return node;
		}),
	};
}
