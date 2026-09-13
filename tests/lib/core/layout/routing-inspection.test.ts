import { describe, expect, it } from 'vitest';

import { layoutGraph } from '../../../../src/app/web/projection/layout-graph';
import {
	defined,
	layoutConfiguration,
	LayoutDirection,
} from '../../../../src/lib/core/document/logic-document';
import { RoutingQuaySide } from '../../../../src/lib/core/layout/layout-types';
import { validLogicDocument } from '../../../support/builders/logic-document';
import { graphFixtures } from '../../../support/fixtures/graph-fixtures';
import { junctionFixtures } from '../../../support/fixtures/junction-fixtures';
import { layoutDocument } from '../../../support/harnesses/layout';
import { layoutNodes } from '../../../support/harnesses/layout-nodes';
import { defaultBiasFor } from '../../../support/harnesses/visual-directions';

describe.each(Object.values(LayoutDirection))('routing inspection in %s', (direction) => {
	it('does not invent a node corridor between independent group attachments', async () => {
		const base = validLogicDocument();
		// Two independent pairs occupy the same ranks: group → node and node → group.
		const fixture = await layoutDocument({
			...base,
			layout: defined(layoutConfiguration(direction, defaultBiasFor(direction))),
			groups: base.groups.filter(({ id }) => id !== 'container'),
			nodes: base.nodes.filter(({ groupId }) => groupId === undefined),
			junctions: [],
			relations: [
				{ id: 'group-to-node', from: 'endpoint-group', to: 'target' },
				{ id: 'node-to-group', from: 'isolated', to: 'orphan-group' },
			],
		});
		const inspected = await layoutGraph(fixture.graph, fixture.ranks, fixture.measurements, {
			inspectRouting: true,
		});
		expect(inspected.relations).toEqual(fixture.layout.relations);
		expect(inspected.routingInspection?.corridors).toEqual([]);
	});
	it('exposes occupied junction rails and the original content behind enlarged quays', async () => {
		const chain = await layoutNodes({
			...junctionFixtures.chain(direction, ['j1', 'j2', 'j3']).build(),
			direction,
		});
		const inspection = defined(chain.routingInspection);
		expect(inspection.corridors).toHaveLength(1);
		expect(inspection.corridors[0]?.rails.flatMap((rail) => rail.junctions ?? []).sort()).toEqual([
			'j1',
			'j2',
			'j3',
		]);
		const crossing = await layoutNodes({
			...junctionFixtures.crossing(direction).build(),
			direction,
		});
		for (const id of ['j1', 'j2']) {
			const node = defined(crossing.routingInspection?.nodes.find((node) => node.id === id));
			expect(node.content).toMatchObject({ width: 28, height: 20 });
			expect(node.incomingMinimum).toBe(16);
			expect(node.outgoingMinimum).toBe(16);
			expect(node.quays.filter((quay) => quay.side === RoutingQuaySide.Incoming)).toHaveLength(1);
			expect(node.quays.filter((quay) => quay.side === RoutingQuaySide.Outgoing)).toHaveLength(1);
		}
	});
	it.each([80, 200])('explains real quays, rails and content size %i', async (content) => {
		const layout = await layoutNodes({
			...graphFixtures.crossingRoutes(direction, content).build(),
			direction,
		});
		const inspection = defined(layout.routingInspection);
		expect(inspection.nodes).toHaveLength(4);
		expect(inspection.corridors).toHaveLength(1);
		const corridor = defined(inspection.corridors[0]);
		expect(corridor).toMatchObject({ rank: 0, allocated: true, requiredGap: 120 });
		expect(corridor.rails).toHaveLength(3);
		for (const node of inspection.nodes) {
			expect(node.content.width * node.content.height).toBe(content * 60);
			expect(node.quays).toHaveLength(2);
			expect(Math.max(node.incomingMinimum, node.outgoingMinimum)).toBe(96);
			const box = layout.getById(node.id).bounds;
			expect(box.width * box.height).toBe(Math.max(content, 96) * 60);
			for (const quay of node.quays)
				for (const id of quay.relations) {
					const route = defined(layout.relations.find((relation) => relation.id === id));
					let endpoint = route.points[0];
					if (quay.side === RoutingQuaySide.Incoming) endpoint = route.points.at(-1);
					expect(quay.point).toEqual(endpoint);
				}
		}
		for (const rail of corridor.rails) {
			expect(rail.relations.length).toBeGreaterThan(0);
			for (const id of rail.relations) {
				const route = defined(layout.relations.find((relation) => relation.id === id));
				let coordinates = route.points.map((point) => point.x);
				if (inspection.vertical) coordinates = route.points.map((point) => point.y);
				expect(
					coordinates.filter((value) => value === rail.coordinate).length,
				).toBeGreaterThanOrEqual(2);
			}
		}
		expect(layout.withReference('Before', layout).routingInspection).toBe(inspection);
		expect(layout.withElements(layout.elements).routingInspection).toBeUndefined();
	});
	it('groups shared default quays and leaves isolated nodes without quays', async () => {
		const layout = await layoutNodes({
			...graphFixtures.twoSuccessors().nodes(['isolated']).build(),
			direction,
		});
		const inspection = defined(layout.routingInspection);
		expect(inspection.nodes.find((node) => node.id === 'isolated')?.quays).toEqual([]);
		expect(inspection.nodes.find((node) => node.id === 'a')?.quays).toHaveLength(1);
		expect(inspection.nodes.find((node) => node.id === 'a')?.quays[0]?.relations).toHaveLength(2);
		expect(
			inspection.nodes.every((node) => node.incomingMinimum === 0 && node.outgoingMinimum === 0),
		).toBe(true);
		expect(inspection.corridors[0]).toMatchObject({ allocated: false, requiredGap: 72 });
	});
});
it('keeps diagnostics opt-in without altering production geometry, including groups and junctions', async () => {
	const fixture = await layoutDocument(validLogicDocument());
	expect(fixture.layout.routingInspection).toBeUndefined();
	const { routingInspection, ...geometry } = await layoutGraph(
		fixture.graph,
		fixture.ranks,
		fixture.measurements,
		{ inspectRouting: true },
	);
	expect(geometry).toEqual(fixture.layout);
	expect(routingInspection?.nodes.map(({ id }) => id)).toEqual(
		[...fixture.graph.document.nodes, ...fixture.graph.document.junctions]
			.map(({ id }) => id)
			.sort(),
	);
});
