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
	/** Encloses every node and junction in one group with this ID. */
	readonly enclosingGroup?: string;
}

const ENCLOSING_GROUP_MEASUREMENT = {
	minimumWidth: 160,
	minimumHeight: 90,
	headerHeight: 42,
	padding: 24,
};

/** Measured endpoint fixture using the actual graph, rank and layout pipelines. */
export async function layoutNodes({
	direction,
	bias = defaultBiasFor(direction),
	nodes,
	junctions = {},
	relations,
	edit,
	reference,
	enclosingGroup,
}: NodeFixture): Promise<VisualLayout> {
	const orders = new Map<string, OrderKey>();
	let previous: OrderKey | undefined;
	const groupIds: string[] = [];
	let membership: { readonly groupId?: string } = {};
	if (enclosingGroup !== undefined) {
		groupIds.push(enclosingGroup);
		membership = { groupId: enclosingGroup };
	}
	for (const id of [...groupIds, ...Object.keys(nodes), ...Object.keys(junctions)]) {
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
		})),
		junctions: Object.keys(junctions).map((id) => ({
			id,
			kind: EndpointKind.Junction,
			operator: JunctionOperator.Xor,
			layoutOrder: defined(orders.get(id)),
			...membership,
		})),
		nodes: Object.keys(nodes).map((id) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id.toUpperCase(),
			layoutOrder: defined(orders.get(id)),
			...membership,
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
			groups: new Map(groupIds.map((id) => [id, ENCLOSING_GROUP_MEASUREMENT])),
			junctions: new Map(Object.entries(junctions)),
		},
		{ inspectRouting: true },
	);
	let observedDocument: LogicDocument | undefined;
	if (edit !== undefined || enclosingGroup !== undefined) observedDocument = editedDocument;
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
	let group = {};
	if (enclosingGroup !== undefined) group = { enclosingGroup };
	const before = await layoutNodes({ ...referenceData, direction, bias, ...group });
	return layout.withReference('Avant / référence', before);
}
