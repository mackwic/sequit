import { layoutGraph } from '../../../src/app/web/projection/layout-graph';
import {
	defined,
	EndpointKind,
	type LayoutBias,
	layoutConfiguration,
	type LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../src/lib/core/document/order-key';
import { createGraph } from '../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../src/lib/core/graph/topological-ranks';
import { layoutMeasurementsFor } from '../builders/layout-measurements';
import { defaultBiasFor } from './visual-directions';
import { VisualLayout } from './visual-layout';

export async function layoutGroupSidePort(
	withSibling: boolean,
	direction: LayoutDirection,
	bias: LayoutBias = defaultBiasFor(direction),
	groupAsTarget = false,
): Promise<VisualLayout> {
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'group-side-port',
		title: 'Départ latéral d’un groupe vide',
		layout: defined(layoutConfiguration(direction, bias)),
		natures: [{ id: 'precondition', label: 'Precondition', color: '#8981ec' }],
		groups: [
			{
				id: 'data-team',
				kind: EndpointKind.Group,
				label: 'Data team',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: [
			{
				id: 'ai-content-generation',
				kind: EndpointKind.Node,
				natureId: 'precondition',
				markdown: 'AI tooling for content generation',
				layoutOrder: orderKey('a2'),
			},
		],
		junctions: [],
		relations: [
			{
				id: 'data-team-to-ai-content-generation',
				from: 'data-team',
				to: 'ai-content-generation',
			},
		],
	};
	let observed = document;
	if (withSibling)
		observed = {
			...document,
			nodes: [
				...document.nodes,
				{
					id: 'prompt-management',
					kind: EndpointKind.Node,
					natureId: 'precondition',
					markdown: 'Prompt management solution',
					layoutOrder: orderKey('a1'),
				},
			],
			relations: [
				...document.relations,
				{
					id: 'prompt-management-to-ai-content-generation',
					from: 'prompt-management',
					to: 'ai-content-generation',
				},
			],
		};
	if (groupAsTarget)
		observed = {
			...observed,
			relations: observed.relations.map(({ from, to }) => ({
				id: `${to}-to-${from}`,
				from: to,
				to: from,
			})),
		};
	const graph = createGraph(observed);
	if (!graph.ok) throw new Error('Expected an acyclic group-port reproduction.');
	const ranks = topologicallyRank(graph.value);
	const measurements = layoutMeasurementsFor(observed, {
		groups: {
			'data-team': { minimumWidth: 160, minimumHeight: 90, headerHeight: 42, padding: 24 },
		},
		nodes: {
			'ai-content-generation': { width: 220, height: 108 },
			'prompt-management': { width: 220, height: 88 },
		},
	});
	const result = await layoutGraph(graph.value, ranks, measurements, { inspectRouting: true });
	return new VisualLayout(result, ranks.byEndpointId, direction, undefined, observed);
}
