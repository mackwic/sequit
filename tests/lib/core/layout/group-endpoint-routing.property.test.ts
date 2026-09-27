import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	EndpointKind,
	JunctionOperator,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { contactFailure } from '../../../../src/lib/core/layout/dedicated-candidate-validation/route-contacts';
import { validateDedicatedCandidate } from '../../../../src/lib/core/layout/dedicated-candidate-validation/validate';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import {
	prepareRouteObstacles,
	routeHitsObstacles,
} from '../../../../src/lib/core/layout/routing/route-obstacles';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { richAcyclicLogicDocumentArbitrary } from '../../../support/builders/logic-document-arbitrary';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';

const witnesses = {
	A: {
		nodeIds: ['node-00'],
		junctionIds: ['junction-00'],
		relations: [
			{ id: 'node-group', from: 'node-00', to: 'group-02' },
			{ id: 'node-junction', from: 'node-00', to: 'junction-00' },
			{ id: 'junction-group', from: 'junction-00', to: 'group-02' },
		],
	},
	B: {
		nodeIds: ['node-05', 'node-01'],
		junctionIds: [],
		relations: [
			{ id: 'group-first', from: 'group-02', to: 'node-05' },
			{ id: 'first-last', from: 'node-05', to: 'node-01' },
			{ id: 'group-last', from: 'group-02', to: 'node-01' },
		],
	},
	C: {
		nodeIds: ['node-00', 'node-03', 'node-04'],
		junctionIds: ['junction-00'],
		relations: [
			{ id: 'node-junction', from: 'node-00', to: 'junction-00' },
			{ id: 'node-node', from: 'node-00', to: 'node-03' },
			{ id: 'junction-group', from: 'junction-00', to: 'group-02' },
			{ id: 'node-node-last', from: 'node-03', to: 'node-04' },
		],
	},
} as const;

function reducedDocument(
	scenario: keyof typeof witnesses,
	layout: LayoutConfiguration,
): LogicDocument {
	const seed = validLogicDocument();
	const { nodeIds, junctionIds, relations } = witnesses[scenario];
	return {
		...seed,
		layout,
		groups: [
			{ kind: EndpointKind.Group, id: 'group-02', label: 'Group', layoutOrder: orderKey('a9') },
		],
		nodes: nodeIds.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index + 1}`),
		})),
		junctions: junctionIds.map((id) => ({
			kind: EndpointKind.Junction,
			id,
			operator: JunctionOperator.Xor,
			layoutOrder: orderKey('a8'),
		})),
		relations,
	};
}

const directions = [
	{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
	{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Top },
	{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
	{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Left },
] as const satisfies readonly LayoutConfiguration[];

describe.each(['A', 'B', 'C'] as const)('group endpoint obstacle %s', (scenario) => {
	it.each(directions)('routes around foreign boxes in $direction', (configuration) => {
		const document = reducedDocument(scenario, configuration);
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
		const reversed = prepareLayoutDocument({
			...document,
			groups: document.groups.toReversed(),
			nodes: document.nodes.toReversed(),
			junctions: document.junctions.toReversed(),
			relations: document.relations.toReversed(),
		});
		expect(
			layoutWithDedicatedEngine(reversed.graph, reversed.ranks, reversed.measurements),
		).toEqual(layout);
	});
});

it.each(directions)(
	'avoids an intermediate node when a populated group shares its target’s logical rank ($direction)',
	(configuration) => {
		const seed = validLogicDocument();
		const document: LogicDocument = {
			...seed,
			layout: configuration,
			groups: [{ kind: EndpointKind.Group, id: 'G', label: 'G', layoutOrder: orderKey('a0') }],
			nodes: ['m', 'u', 't'].map((id, index) => {
				const node = {
					kind: EndpointKind.Node as const,
					id,
					natureId: 'goal',
					markdown: id,
					layoutOrder: orderKey(`a${index + 1}`),
				};
				if (id === 'm') return { ...node, groupId: 'G' };
				return node;
			}),
			junctions: [],
			relations: [
				{ id: 'm-u', from: 'm', to: 'u' },
				{ id: 'u-t', from: 'u', to: 't' },
				{ id: 'G-t', from: 'G', to: 't' },
			],
		};
		const prepared = prepareLayoutDocument(document, {
			groups: { G: { minimumWidth: 160, minimumHeight: 72, headerHeight: 4, padding: 4 } },
		});
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
	},
);

it.each(directions)(
	'does not change an independent fork when a group shortcut requires reserved rails ($direction)',
	(configuration) => {
		const seed = validLogicDocument();
		const nodes = ['a', 'b', 'c', 'q', 't'].map((id, index) => ({
			kind: EndpointKind.Node as const,
			id,
			natureId: 'goal',
			markdown: id,
			layoutOrder: orderKey(`a${index + 1}`),
		}));
		const fork: LogicDocument = {
			...seed,
			layout: configuration,
			groups: [],
			nodes: nodes.slice(0, 3),
			junctions: [],
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'a-c', from: 'a', to: 'c' },
			],
		};
		const combined: LogicDocument = {
			...fork,
			groups: [{ kind: EndpointKind.Group, id: 'G', label: 'G', layoutOrder: orderKey('a9') }],
			nodes,
			relations: [
				...fork.relations,
				{ id: 'G-q', from: 'G', to: 'q' },
				{ id: 'q-t', from: 'q', to: 't' },
				{ id: 'G-t', from: 'G', to: 't' },
			],
		};
		const original = prepareLayoutDocument(fork);
		const expanded = prepareLayoutDocument(combined);
		const base = layoutWithDedicatedEngine(original.graph, original.ranks, original.measurements);
		const result = layoutWithDedicatedEngine(expanded.graph, expanded.ranks, expanded.measurements);
		const relative = (layout: typeof base) => {
			const anchor = layout.elements.find(({ id }) => id === 'a')?.bounds;
			if (anchor === undefined) throw new Error('Missing fork source');
			return layout.relations
				.filter(({ from }) => from === 'a')
				.map(({ id, points }) => ({
					id,
					points: points.map(({ x, y }) => ({ x: x - anchor.x, y: y - anchor.y })),
				}));
		};
		expect(relative(result)).toEqual(relative(base));
	},
);

it('publishes only valid group and junction routes in the rich corpus', () => {
	for (const document of fc.sample(richAcyclicLogicDocumentArbitrary(), {
		seed: 1592915777,
		numRuns: 200,
	})) {
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements);
		const nodeObstacles = prepareRouteObstacles(
			layout.elements.filter(({ kind }) => kind !== EndpointKind.Group).map(({ bounds }) => bounds),
			0,
		);
		const groupIds = new Set(document.groups.map(({ id }) => id));
		for (const route of layout.relations) {
			if (!groupIds.has(route.from) && !groupIds.has(route.to)) continue;
			expect(routeHitsObstacles(route.points, nodeObstacles), route.id).toBe(false);
		}
		expect(contactFailure(layout.relations, routeBridgeAnalysis(layout.relations))).toBeUndefined();
		expect(validateDedicatedCandidate({ ...prepared, layout })).toMatchObject({ valid: true });
	}
});
