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

it('keeps group incidents clear of nodes, junctions and forbidden route contacts in the rich corpus', () => {
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
		const validation = validateDedicatedCandidate({ ...prepared, layout });
		if (!validation.valid) {
			expect(validation.code).toBe('obstacle');
			expect(validation.endpointId).toBeDefined();
		}
	}
});
