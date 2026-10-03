import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { barycentricSweep } from '../../../../src/lib/core/layout/rank/rank-order-heuristic';
import { collectRankOrderDomain } from '../../../../src/lib/core/layout/rank/rank-ordering';
import { prepareLayout } from '../../../../src/lib/core/layout/structure/prepare-layout';

function junctionSweepWitness() {
	const layout = layoutConfiguration(LayoutDirection.TopToBottom, LayoutBias.Top);
	if (layout === undefined) throw new Error('Missing layout configuration');
	const ids = ['parent-through-junction', 'parent-direct', 'direct-child', 'junction-child'];
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'junction-sweep-witness',
		title: 'Junction sweep witness',
		layout,
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [],
		nodes: ids.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: id,
			layoutOrder: orderKey(`a${index}`),
		})),
		junctions: [
			{
				kind: EndpointKind.Junction,
				id: 'junction',
				operator: JunctionOperator.Xor,
				layoutOrder: orderKey('a2'),
			},
		],
		relations: [
			{ id: 'direct', from: 'parent-direct', to: 'direct-child' },
			{
				id: 'shared-parent',
				from: 'parent-through-junction',
				to: 'direct-child',
			},
			{ id: 'into-junction', from: 'parent-through-junction', to: 'junction' },
			{ id: 'out-of-junction', from: 'junction', to: 'junction-child' },
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid junction sweep witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	return { domain, structure };
}

function rigidBlockSweepWitness() {
	const layout = layoutConfiguration(LayoutDirection.TopToBottom, LayoutBias.Top);
	if (layout === undefined) throw new Error('Missing layout configuration');
	const ids = [
		'inside-left',
		'inside-middle',
		'outside-middle',
		'outside-right',
		'inside-upper',
		'outside-upper',
	];
	const members: Record<string, true> = {
		'inside-left': true,
		'inside-middle': true,
		'inside-upper': true,
	};
	const document: LogicDocument = {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: 'rigid-block-sweep-witness',
		title: 'Rigid block sweep witness',
		layout,
		natures: [{ id: 'task', label: 'Task', color: '#456858' }],
		groups: [
			{
				kind: EndpointKind.Group,
				id: 'rigid',
				label: 'Rigid',
				layoutOrder: orderKey('a0'),
			},
		],
		nodes: ids.map((id, index) => {
			const node = {
				kind: EndpointKind.Node,
				id,
				natureId: 'task',
				markdown: id,
				layoutOrder: orderKey(`a${index + 1}`),
			} as const;
			if (members[id] === true) return { ...node, groupId: 'rigid' };
			return node;
		}),
		junctions: [],
		relations: [
			{ id: 'upper-left', from: 'inside-upper', to: 'inside-left' },
			{ id: 'upper-middle', from: 'inside-upper', to: 'inside-middle' },
			{ id: 'upper-right', from: 'inside-upper', to: 'outside-right' },
			{ id: 'outside-links', from: 'outside-upper', to: 'outside-middle' },
			{ id: 'outside-right-link', from: 'outside-upper', to: 'outside-right' },
		],
	};
	const created = createGraph(document);
	if (!created.ok) throw new Error('Invalid rigid block sweep witness');
	const graph = created.value;
	const ranks = topologicallyRank(graph);
	const structure = prepareLayout(graph, ranks);
	const domain = collectRankOrderDomain(structure);
	return { domain, structure };
}

describe('rank barycentric sweep corrections', () => {
	it('uses the placed parent beyond an unplaced junction to order its child', () => {
		const { domain, structure } = junctionSweepWitness();
		expect(domain.bands).toEqual([
			['direct-child', 'junction-child'],
			['parent-through-junction', 'parent-direct'],
		]);
		const swept = barycentricSweep({ structure, domain }, domain.bands, true);
		expect(swept[0]).toEqual(['junction-child', 'direct-child']);
	});

	it('keeps a band in its candidate order when all its neighbours are still unplaced', () => {
		const { domain, structure } = junctionSweepWitness();
		const reversed: readonly (readonly string[])[] = [
			['junction-child', 'direct-child'],
			['parent-through-junction', 'parent-direct'],
		];
		const swept = barycentricSweep({ structure, domain }, reversed, false);
		expect(swept[0]).toEqual(['junction-child', 'direct-child']);
	});

	it('does not let a future row pull the band before the sweep reaches it', () => {
		const { domain, structure } = junctionSweepWitness();
		const swept = barycentricSweep({ structure, domain }, domain.bands, false);
		expect(swept[0]).toEqual(['direct-child', 'junction-child']);
	});
	it('anchors a spanning block to its position in the adjacent placed row', () => {
		const { domain, structure } = rigidBlockSweepWitness();
		const blockBand = domain.bands.findIndex(
			(band) => band.includes('rigid') && band.includes('outside-upper'),
		);
		expect(domain.bands[blockBand]).toEqual(['rigid', 'outside-upper']);
		const swept = barycentricSweep({ structure, domain }, domain.bands, false);
		expect(swept[blockBand]).toEqual(['rigid', 'outside-upper']);
	});
});
