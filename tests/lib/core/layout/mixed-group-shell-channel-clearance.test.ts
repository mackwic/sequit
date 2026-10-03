import { expect, it } from 'vitest';

import {
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { GROUP_FRAME_CLEARANCE } from '../../../../src/lib/core/layout/layout-settings';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

it('keeps a crossing rail clear of an intervening group frame shell', () => {
	const ids = ['a', 'b', 'c', 'd'];
	const document = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'group-shell-channel-clearance',
		title: 'group-shell-channel-clearance',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'group',
				label: 'Group',
				layoutOrder: orderKey('a0'),
			},
		],
		junctions: [],
		nodes: ids.map((id, index) => {
			const node = {
				id,
				kind: EndpointKind.Node,
				natureId: 'task',
				markdown: id,
				layoutOrder: orderKey(['a1', 'a2', 'a3', 'a4'][index] ?? 'a4'),
			};
			if (id === 'b') return { ...node, groupId: 'group' };
			return node;
		}),
		relations: [
			{ id: 'a-to-c', from: 'a', to: 'c' },
			{ id: 'a-to-d', from: 'a', to: 'd' },
			{ id: 'b-to-c', from: 'b', to: 'c' },
			{ id: 'b-to-d', from: 'b', to: 'd' },
		],
	};
	const prepared = prepareLayoutDocument(document);
	const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
	const frame = layout.elements.find(({ id }) => id === 'group')?.bounds;
	const route = layout.relations.find(({ id }) => id === 'a-to-d');
	if (frame === undefined || route === undefined) throw new Error('Missing group frame or route');
	const railY = route.points.slice(1).find((point, index) => {
		const previous = route.points[index];
		if (previous === undefined) return false;
		return (
			previous.y === point.y &&
			Math.max(previous.x, point.x) > frame.x &&
			Math.min(previous.x, point.x) < frame.x + frame.width
		);
	})?.y;
	if (railY === undefined) throw new Error('Missing crossing rail beside the group shell');
	expect(frame.y - railY).toBeGreaterThanOrEqual(GROUP_FRAME_CLEARANCE);
});
