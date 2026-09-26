import { realK32Fixture } from '../../../src/app/workshop/solver-prototype/real-k32-witness';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import type { LayoutMeasurementOverrides } from '../builders/layout-measurements';

/** The documentary rank order already matches the retained single-pipeline rail witness. */
export function railReuseDocument(): LogicDocument {
	const ids = ['a', 'b', 'c', 'd', 'e'];
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rail-reuse',
		title: 'rail-reuse',
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'sink',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a6'),
			},
		],
		nodes: ids.map((id, index) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(['a2', 'a1', 'a3', 'a4', 'a5'][index] ?? 'a5'),
		})),
		relations: [
			{ id: 'a-to-d', from: 'a', to: 'd' },
			{ id: 'b-to-c', from: 'b', to: 'c' },
			{ id: 'c-to-e', from: 'c', to: 'e' },
			{ id: 'd-to-e', from: 'd', to: 'e' },
			{ id: 'c-to-sink', from: 'c', to: 'sink' },
			{ id: 'd-to-sink', from: 'd', to: 'sink' },
		],
	};
}

/** Keep the inverted channel intact; a disconnected tree puts validation outside the work envelope. */
export function railClearanceDocument(): LogicDocument {
	const base = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse').document;
	const ids = Array.from({ length: 15 }, (_, index) => `wide-${index}`);
	return {
		...base,
		nodes: [
			...base.nodes,
			...ids.map((id) => ({
				id,
				kind: EndpointKind.Node as const,
				natureId: 'goal',
				markdown: id,
				layoutOrder: orderKey('a6'),
			})),
		],
		relations: [
			...base.relations,
			...ids.slice(1).map((id, index) => ({
				id: `wide-route-${index}`,
				from: defined(ids[Math.floor(index / 2)]),
				to: id,
			})),
		],
	};
}

export function railClearanceMeasurements(clearance: 12 | 13): LayoutMeasurementOverrides {
	let widths = [131, 178, 225, 272, 319];
	if (clearance === 13) widths = [129, 176, 223, 270, 317];
	return {
		nodes: Object.fromEntries(
			['a', 'b', 'c', 'd', 'e'].map((id, index) => [
				id,
				{ width: defined(widths[index]), height: 116 },
			]),
		),
	};
}
