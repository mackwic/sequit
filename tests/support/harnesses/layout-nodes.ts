import { layoutGraph } from '../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	JunctionOperator,
	type LayoutBias,
	layoutConfiguration,
	type LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import type { OrderKey } from '../../../src/lib/core/document/order-key';
import { createGraph } from '../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../src/lib/core/graph/topological-ranks';
import type { GroupMeasurement } from '../../../src/lib/core/layout/layout-types';
import { fractionalOrderKeySpace } from '../../../src/lib/core/ordering/order-key-space';
import type { VisualGraphData } from '../builders/visual-graph-builder';
import { defaultBiasFor } from './visual-directions';
import { editVisualDocument, type VisualDocumentEdit } from './visual-document-edit';
import { VisualLayout } from './visual-layout';

interface NodeFixture extends VisualGraphData {
	readonly direction: LayoutDirection;
	readonly bias?: LayoutBias | undefined;
	readonly edit?: VisualDocumentEdit;
	readonly reference?: VisualGraphData | true;
	/** Group ID → member IDs (nodes, junctions or groups); unlisted endpoints stay at the root. */
	readonly groups?: Readonly<Record<string, readonly string[]>>;
	/** Group ID → measurement replacing the default one. */
	readonly groupMeasurements?: Readonly<Record<string, GroupMeasurement>> | undefined;
}

const GROUP_MEASUREMENT: GroupMeasurement = {
	minimumWidth: 160,
	minimumHeight: 90,
	headerHeight: 42,
	padding: 24,
};

function membershipsOf(
	groups: Readonly<Record<string, readonly string[]>>,
): ReadonlyMap<string, { readonly groupId: string }> {
	const memberships = new Map<string, { readonly groupId: string }>();
	for (const [groupId, members] of Object.entries(groups))
		for (const id of members) {
			if (memberships.has(id)) throw new Error(`Endpoint ${id} belongs to several groups.`);
			memberships.set(id, { groupId });
		}
	return memberships;
}

/** Each group takes its documentary slot just before its first member; empty groups come last. */
function documentaryOrder(
	endpoints: readonly string[],
	groupIds: readonly string[],
	memberships: ReadonlyMap<string, { readonly groupId: string }>,
): readonly string[] {
	const order: string[] = [];
	const placed = new Set<string>();
	for (const id of endpoints) {
		const ancestors: string[] = [];
		for (
			let group = memberships.get(id);
			group !== undefined;
			group = memberships.get(group.groupId)
		)
			if (!placed.has(group.groupId)) ancestors.unshift(group.groupId);
		for (const group of [...ancestors, id]) placed.add(group);
		order.push(...ancestors, id);
	}
	return [...order, ...groupIds.filter((id) => !placed.has(id))];
}

/** Measured endpoint fixture using the actual graph, rank and layout pipelines. */
export async function layoutNodes({
	direction,
	bias = defaultBiasFor(direction),
	nodes,
	junctions = {},
	relations,
	edit,
	reference,
	groups = {},
	groupMeasurements = {},
}: NodeFixture): Promise<VisualLayout> {
	const orders = new Map<string, OrderKey>();
	let previous: OrderKey | undefined;
	const groupIds = Object.keys(groups);
	const memberships = membershipsOf(groups);
	const endpoints = [...Object.keys(nodes), ...Object.keys(junctions)];
	for (const id of documentaryOrder(endpoints, groupIds, memberships)) {
		let slot = {};
		if (previous !== undefined) slot = { before: previous };
		previous = fractionalOrderKeySpace.keyFor(slot);
		orders.set(id, previous);
	}
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'visual-node-fixture',
		title: 'Visual node fixture',
		layout: defined(
			layoutConfiguration(direction, bias),
			`Incompatible layout direction and bias: ${direction}, ${bias}`,
		),
		natures: [{ id: 'goal', label: 'Goal', color: '#285448' }],
		groups: groupIds.map((id) => ({
			id,
			kind: EndpointKind.Group,
			label: id.toUpperCase(),
			layoutOrder: defined(orders.get(id)),
			...memberships.get(id),
		})),
		junctions: Object.keys(junctions).map((id) => ({
			id,
			kind: EndpointKind.Junction,
			operator: JunctionOperator.Xor,
			layoutOrder: defined(orders.get(id)),
			...memberships.get(id),
		})),
		nodes: Object.keys(nodes).map((id) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id.toUpperCase(),
			layoutOrder: defined(orders.get(id)),
			...memberships.get(id),
		})),
		relations,
	};
	const editedDocument = editVisualDocument(document, edit);
	const graph = createGraph(editedDocument);
	if (!graph.ok) throw new Error('The visual node fixture must form an acyclic graph.');
	const ranks = topologicallyRank(graph.value);
	const result = await layoutGraph(
		graph.value,
		ranks,
		{
			nodes: new Map(Object.entries(nodes)),
			groups: new Map(groupIds.map((id) => [id, groupMeasurements[id] ?? GROUP_MEASUREMENT])),
			junctions: new Map(Object.entries(junctions)),
		},
		{ inspectRouting: true },
	);
	let observedDocument: LogicDocument | undefined;
	if (edit !== undefined || groupIds.length > 0) observedDocument = editedDocument;
	const layout = new VisualLayout(
		result,
		ranks.byEndpointId,
		direction,
		undefined,
		observedDocument,
	);
	if (reference === undefined) return layout;
	let referenceData: VisualGraphData = { nodes, junctions, relations };
	if (reference !== true) referenceData = reference;
	const before = await layoutNodes({
		...referenceData,
		direction,
		bias,
		groups,
		groupMeasurements,
	});
	return layout.withReference('Avant / référence', before);
}
