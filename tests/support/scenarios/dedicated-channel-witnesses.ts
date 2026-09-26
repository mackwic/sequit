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

/** A single-column downstream chain exceeds the measured local search budget without widening the tested channel. */
export function railClearanceDocument(): LogicDocument {
	const base = realK32Fixture(LayoutDirection.TopToBottom, 'd-e', 'sparse').document;
	const ids = Array.from({ length: 41 }, (_, index) => `wide-${index}`);
	return {
		...base,
		nodes: [
			...base.nodes,
			...ids.map((id) => ({
				id,
				kind: EndpointKind.Node as const,
				natureId: defined(base.natures[0]).id,
				markdown: id,
				layoutOrder: orderKey('a6'),
			})),
		],
		relations: [
			...base.relations,
			{ id: 'wide-anchor', from: defined(ids[0]), to: 'a' },
			...ids.slice(1).map((id, index) => ({
				id: `wide-route-${index}`,
				from: id,
				to: defined(ids[index]),
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

function makeDocument(
	id: string,
	ids: readonly string[],
	relations: LogicDocument['relations'],
): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id,
		title: id,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		junctions: [],
		nodes: ids.map((nodeId, index) => ({
			id: nodeId,
			kind: EndpointKind.Node,
			natureId: 'task',
			markdown: nodeId,
			layoutOrder: orderKey(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'][index] ?? 'a6'),
		})),
		relations,
	};
}

export function groupedJunction(
	id: string,
	relations: LogicDocument['relations'],
	groupedNodeIds: readonly string[] = ['a', 'b', 'd'],
): LogicDocument {
	const base = makeDocument(id, ['a', 'b', 'c', 'd', 'e', 'f'], relations);
	return {
		...base,
		groups: [
			{ kind: EndpointKind.Group, id: 'group', label: 'Group', layoutOrder: orderKey('a0') },
		],
		nodes: base.nodes.map((node) => {
			if (groupedNodeIds.includes(node.id)) return { ...node, groupId: 'group' };
			return node;
		}),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'join',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a7'),
			},
		],
		relations,
	};
}

export const multirankOne = groupedJunction('multirank-group-junction-one', [
	{ id: 'a-to-d', from: 'a', to: 'd' },
	{ id: 'b-to-c', from: 'b', to: 'c' },
	{ id: 'c-to-e', from: 'c', to: 'e' },
	{ id: 'd-to-f', from: 'd', to: 'f' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);
export const multirankTwo = groupedJunction('multirank-group-junction-two', [
	{ id: 'a-to-c', from: 'a', to: 'c' },
	{ id: 'b-to-d', from: 'b', to: 'd' },
	{ id: 'c-to-f', from: 'c', to: 'f' },
	{ id: 'd-to-e', from: 'd', to: 'e' },
	{ id: 'e-to-join', from: 'e', to: 'join' },
	{ id: 'f-to-join', from: 'f', to: 'join' },
]);
export function junctionNetworkDocument(id: string): LogicDocument {
	return {
		...makeDocument(
			id,
			['a', 'b', 'c', 'd'],
			[
				{ id: 'j-to-a', from: 'j', to: 'a' },
				{ id: 'j-to-d-one', from: 'j', to: 'd' },
				{ id: 'j-to-d-two', from: 'j', to: 'd' },
				{ id: 'k-to-b', from: 'k', to: 'b' },
				{ id: 'k-to-a', from: 'k', to: 'a' },
				{ id: 'a-to-sink', from: 'a', to: 'sink' },
				{ id: 'b-to-sink', from: 'b', to: 'sink' },
				{ id: 'j-to-sink', from: 'j', to: 'sink' },
				{ id: 'k-to-sink', from: 'k', to: 'sink' },
			],
		),
		junctions: ['j', 'k', 'sink'].map((id, index) => ({
			kind: EndpointKind.Junction as const,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey(['a0', 'a1', 'a2'][index] ?? 'a2'),
		})),
	};
}
