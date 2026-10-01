import {
	defined,
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';

export const LANE_ROW_DIRECTIONS = [
	[LayoutDirection.TopToBottom, LayoutBias.Top],
	[LayoutDirection.BottomToTop, LayoutBias.Bottom],
	[LayoutDirection.LeftToRight, LayoutBias.Left],
	[LayoutDirection.RightToLeft, LayoutBias.Right],
] as const;

export const LANE_ROW_ORIENTATIONS = [
	LaneOrientation.Parallel,
	LaneOrientation.Transverse,
] as const;

export interface LaneRowsSpec {
	readonly direction: (typeof LANE_ROW_DIRECTIONS)[number];
	readonly orientation: LaneOrientation;
	/** Lanes in presentation order. */
	readonly lanes: readonly string[];
	/** `[node, lane]` in documentary (`layoutOrder`) order. */
	readonly nodes: readonly (readonly [string, string])[];
	/** `[child, parent]`: each relation goes from the child to its parent. */
	readonly relations: readonly (readonly [string, string])[];
}

/** Ordinary 220 × 116 tasks on explicit root lanes, ordered as listed. */
export function laneRowsDocument(spec: LaneRowsSpec): LogicDocument {
	const [direction, bias] = spec.direction;
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'lane-rows',
		title: 'Lane rows',
		layout: defined(layoutConfiguration(direction, bias)),
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: spec.orientation,
			growth: LaneGrowth.Auto,
			lanes: spec.lanes.map((id, index) => ({ id, label: id, layoutOrder: orderKey(`a${index}`) })),
		},
		natures: [{ id: 'task', label: 'Task', color: '#000000' }],
		groups: [],
		nodes: spec.nodes.map(([id, laneId], index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id.toUpperCase(),
			laneId,
			layoutOrder: orderKey(`a${index}`),
		})),
		junctions: [],
		relations: spec.relations.map(([from, to]) => ({ id: `${from}-${to}`, from, to })),
	};
}
