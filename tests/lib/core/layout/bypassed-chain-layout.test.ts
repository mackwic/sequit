import { describe, expect, it } from 'vitest';

import { EndpointKind, type LogicDocument } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { AssertLayout } from '../../../support/assertions/assert-layout';
import { LAYOUT_CONFIGURATIONS } from '../../../support/builders/layout-bias-scenario';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { VisualGraphBuilder } from '../../../support/builders/visual-graph-builder';
import { portPolicy } from '../../../support/fixtures/routing-fixtures';
import { contains, layoutDocument } from '../../../support/harnesses/layout';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { axesFor } from '../../../support/harnesses/visual-directions';
import { VisualLayout } from '../../../support/harnesses/visual-layout';

function bypassedChain() {
	return new VisualGraphBuilder({ width: 100, height: 60 })
		.nodes(['a', 'b', 'c', 'd'])
		.arrowsFrom('b', ['a'])
		.arrowsFrom('c', ['b'])
		.arrowsFrom('d', ['c', 'a']);
}

const ineligible = [
	{ label: 'an extra branch', graph: bypassedChain().nodes(['e']).arrowsFrom('e', ['b']).build() },
	{ label: 'an extra bypass', graph: bypassedChain().arrowsFrom('c', ['a']).build() },
	{
		label: 'a bypass of only part of the chain',
		graph: new VisualGraphBuilder({ width: 100, height: 60 })
			.nodes(['a', 'b', 'c', 'd'])
			.arrowsFrom('b', ['a'])
			.arrowsFrom('c', ['b'])
			.arrowsFrom('d', ['c', 'b'])
			.build(),
	},
	{
		label: 'a parallel bypass',
		graph: bypassedChain().relation({ id: 'parallel-bypass', from: 'd', to: 'a' }).build(),
	},
	{
		label: 'a junction',
		graph: new VisualGraphBuilder({ width: 100, height: 60 })
			.nodes(['a', 'b', 'c', 'd'])
			.junctions(['j'])
			.arrowsFrom('b', ['a'])
			.arrowsFrom('j', ['b'])
			.arrowsFrom('c', ['j'])
			.arrowsFrom('d', ['c', 'a'])
			.build(),
	},
];

describe.each(LAYOUT_CONFIGURATIONS)(
	'bypassed chain boundaries in $direction / $bias',
	(configuration) => {
		it('packs two aligned chains and an ordinary component without losing their outer margins', async () => {
			const fixture = bypassedChain()
				.nodes(['e', 'f', 'g'], { width: 80, height: 80 })
				.arrowsFrom('f', ['e'])
				.arrowsFrom('g', ['f', 'e'])
				.nodes(['h', 'i'])
				.arrowsFrom('i', ['h'])
				.build();
			const layout = await layoutNodes({ ...fixture, ...configuration });
			const check = AssertLayout(layout);
			check.obstacles().haveClearance(24);
			check.routes().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
			for (const { id } of fixture.relations.filter(({ id }) => id !== 'd-to-a' && id !== 'g-to-e'))
				check.route(id).isStraightAlong(axesFor(configuration.direction).primary);
			check.route('d-to-a').usesPositiveSideOf(layout.envelopeOf(['b', 'c']), {
				axis: axesFor(configuration.direction).transverse,
				clearance: 24,
				component: layout.envelopeOf(['a', 'b', 'c', 'd']),
			});
			check.route('g-to-e').usesPositiveSideOf(layout.getById('f'), {
				axis: axesFor(configuration.direction).transverse,
				clearance: 24,
				component: layout.envelopeOf(['e', 'f', 'g']),
			});
			check.envelope(['e', 'f', 'g']).isAfter(layout.envelopeOf(['a', 'b', 'c', 'd']), {
				direction: 'transverse-positive',
			});
			check.envelope(['h', 'i']).isAfter(layout.envelopeOf(['e', 'f', 'g']), {
				direction: 'transverse-positive',
			});
			for (const { bounds } of layout.elements) {
				expect(bounds.x).toBeGreaterThanOrEqual(40);
				expect(bounds.y).toBeGreaterThanOrEqual(40);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width - 40);
				expect(bounds.y + bounds.height).toBeLessThanOrEqual(layout.height - 40);
			}
		});

		it('releases bypass reservations on deletion and matches a fresh compact chain', async () => {
			const fixture = new VisualGraphBuilder({ width: 80, height: 80 })
				.nodes(['a', 'c'])
				.nodes(['b'], { width: 360, height: 360 })
				.arrowsFrom('b', ['a'])
				.arrowsFrom('c', ['b', 'a'])
				.build();
			const before = await layoutNodes({ ...fixture, ...configuration });
			for (const { id } of fixture.relations.slice(0, -1))
				AssertLayout(before).route(id).isStraightAlong(axesFor(configuration.direction).primary);
			AssertLayout(before)
				.route('c-to-a')
				.usesPositiveSideOf(before.getById('b'), {
					axis: axesFor(configuration.direction).transverse,
					clearance: 24,
					component: before.envelopeOf(['a', 'b', 'c']),
				});
			const removed = await layoutNodes({
				...fixture,
				...configuration,
				edit: { removeRelations: ['c-to-a'] },
			});
			const fresh = await layoutNodes({
				...fixture,
				...configuration,
				relations: fixture.relations.filter(({ id }) => id !== 'c-to-a'),
			});
			expect(removed.elements).toEqual(fresh.elements);
			expect(removed.relations).toEqual(fresh.relations);
			expect(removed.routingInspection).toEqual(fresh.routingInspection);
			expect([removed.width, removed.height]).toEqual([fresh.width, fresh.height]);
			const check = AssertLayout(removed);
			check.node('a').hasSizeForPorts({ content: 80, incoming: 1, outgoing: 0, ...portPolicy });
			check.node('c').hasSizeForPorts({ content: 80, incoming: 0, outgoing: 1, ...portPolicy });
			check.node('b').isAlignedWith('a', { by: 'chain' }).isAlignedWith('c', { by: 'chain' });
			check.obstacles().haveClearance(24);
			check.routes().areAttachedToEndpoints().followLayoutFlow().haveNoCrossing();
			for (const { id } of removed.relations)
				check.route(id).isStraightAlong(axesFor(configuration.direction).primary);
			let dimension: 'width' | 'height' = 'width';
			if (axesFor(configuration.direction).transverse === 'y') dimension = 'height';
			for (const id of ['a', 'c'])
				expect(before.getById(id).bounds[dimension]).toBeGreaterThan(
					removed.getById(id).bounds[dimension],
				);
		});

		it.each(ineligible)('keeps valid ordinary routing with $label', async ({ graph }) => {
			const layout = await layoutNodes({ ...graph, ...configuration });
			const check = AssertLayout(layout);
			check.routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
			check.obstacles().haveClearance(0);
		});

		it('preserves group containment and principal routes for an enclosed bypassed chain', async () => {
			const fixture = bypassedChain().build();
			const document: LogicDocument = {
				...validLogicDocument(),
				layout: configuration,
				groups: [
					{
						kind: EndpointKind.Group,
						id: 'group',
						label: 'Group',
						layoutOrder: orderKey('a0'),
					},
				],
				nodes: Object.keys(fixture.nodes).map((id, index) => ({
					kind: EndpointKind.Node,
					id,
					markdown: id,
					natureId: 'goal',
					groupId: 'group',
					layoutOrder: orderKey(`a${index + 1}`),
				})),
				junctions: [],
				relations: fixture.relations,
			};
			const result = await layoutDocument(document, { nodes: fixture.nodes });
			const layout = new VisualLayout(
				result.layout,
				result.ranks.byEndpointId,
				configuration.direction,
			);
			AssertLayout(layout).routes().areOrthogonal().areAttachedToEndpoints().followLayoutFlow();
			for (const id of ['b-to-a', 'c-to-b', 'd-to-c'])
				AssertLayout(layout).route(id).isStraightAlong(axesFor(configuration.direction).primary);
			AssertLayout(layout)
				.route('d-to-a')
				.usesPositiveSideOf(layout.envelopeOf(['b', 'c']), {
					axis: axesFor(configuration.direction).transverse,
					clearance: 24,
					component: layout.envelopeOf(['a', 'b', 'c', 'd']),
				});
			for (const id of Object.keys(fixture.nodes))
				expect(contains(layout.getById('group').bounds, layout.getById(id).bounds)).toBe(true);
			const members = layout.withElements(
				layout.elements.filter(({ kind }) => kind === EndpointKind.Node),
			);
			AssertLayout(members).obstacles().haveClearance(0);
		});
	},
);
