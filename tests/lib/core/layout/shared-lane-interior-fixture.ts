import {
	EndpointKind,
	LANE_PERSISTENCE_FORMAT,
	LaneGrowth,
	LaneOrientation,
	LAYOUT_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';

export function interiorPassageDocument(blocked: boolean): LogicDocument {
	const groups: LogicDocument['groups'][number][] = [];
	if (blocked)
		groups.push({
			kind: EndpointKind.Group,
			id: 'sd-block',
			label: 'SD decision block',
			laneId: 'SD',
			layoutOrder: orderKey('a0'),
		});
	return {
		persistenceFormat: LANE_PERSISTENCE_FORMAT,
		id: 'interior-passage-s-sd-c',
		title: 'S | SD | C interior passage',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		presentation: {
			schemaVersion: LAYOUT_PRESENTATION_SCHEMA,
			policy: LayoutPolicy.Layered,
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'S', label: 'Sales', layoutOrder: orderKey('a0') },
				{ id: 'SD', label: 'Service delivery', layoutOrder: orderKey('a1') },
				{ id: 'C', label: 'Customer', layoutOrder: orderKey('a2') },
			],
		},
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups,
		nodes: [
			{
				kind: EndpointKind.Node,
				id: 'c-request',
				natureId: 'task',
				markdown: 'Request',
				laneId: 'C',
				layoutOrder: orderKey('a0'),
			},
			{
				kind: EndpointKind.Node,
				id: 's-receive',
				natureId: 'task',
				markdown: 'Receive',
				laneId: 'S',
				layoutOrder: orderKey('a1'),
			},
		],
		junctions: [],
		relations: [{ id: 'request', from: 'c-request', to: 's-receive' }],
	};
}
