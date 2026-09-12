import {
	defined,
	EndpointKind,
	type LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../lib/core/document/logic-document';
import { orderKey } from '../../../lib/core/document/order-key';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import type { Size } from '../../../lib/core/layout/layout-types';
import { layoutGraph } from '../../web/projection/layout-graph';
import { defaultBiasFor } from './directions';
import type { VisualGraphData } from './fixtures/visual-graph-builder';
import type { LayoutScenario } from './scenario';
import { VisualLayout } from './visual-layout';

interface NodeFixture extends VisualGraphData {
	readonly direction: LayoutDirection;
	readonly bias?: LayoutBias | undefined;
}

/** Small node-only fixture using the actual graph, rank and layout pipelines. */
export async function layoutNodes({
	direction,
	bias = defaultBiasFor(direction),
	nodes,
	relations,
}: NodeFixture): Promise<VisualLayout> {
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'visual-node-fixture',
		title: 'Visual node fixture',
		layout: defined(
			layoutConfiguration(direction, bias),
			`Incompatible layout direction and bias: ${direction}, ${bias}`,
		),
		natures: [{ id: 'goal', label: 'Goal', color: '#285448' }],
		groups: [],
		junctions: [],
		nodes: Object.keys(nodes).map((id, index) => ({
			id,
			kind: EndpointKind.Node,
			natureId: 'goal',
			markdown: id.toUpperCase(),
			layoutOrder: orderKey(`a${index}`),
		})),
		relations,
	};
	const graph = createGraph(document);
	if (!graph.ok) throw new Error('The visual node fixture must form an acyclic graph.');
	const ranks = topologicallyRank(graph.value);
	const result = await layoutGraph(graph.value, ranks, {
		nodes: new Map(Object.entries(nodes)),
		groups: new Map(),
		junctions: new Map(),
	});
	return new VisualLayout(result, ranks.byEndpointId, direction);
}

interface UniformNodeScenario extends Omit<LayoutScenario, 'arrange'> {
	readonly nodes: readonly string[];
	readonly size: Size;
	readonly relations: LogicDocument['relations'];
}

/** A compact scenario fixture when every node has the same explicit dimensions. */
export function uniformNodeScenario({
	nodes,
	size,
	relations,
	...scenario
}: UniformNodeScenario): LayoutScenario {
	return {
		...scenario,
		arrange(direction = LayoutDirection.TopToBottom, bias) {
			return layoutNodes({
				direction,
				bias,
				relations,
				nodes: Object.fromEntries(nodes.map((id) => [id, size])),
			});
		},
	};
}
