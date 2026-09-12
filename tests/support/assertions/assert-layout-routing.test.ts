import { expect, it } from 'vitest';

import { EndpointKind, LayoutDirection } from '../../../src/lib/core/document/logic-document';
import { graphFixtures } from '../fixtures/graph-fixtures';
import { layoutNodes } from '../harnesses/layout-nodes';
import { axesFor } from '../harnesses/visual-directions';
import { VisualLayout } from '../harnesses/visual-layout';
import { AssertLayout } from './assert-layout';

it.each(Object.values(LayoutDirection))(
	'checks routes and actual rendered bridges independently in %s',
	async (direction) => {
		const layout = await layoutNodes({
			direction,
			...graphFixtures.crossingRoutes(direction).build(),
		});
		const check = AssertLayout(layout);
		const routes = check.routes();
		expect(routes.haveNoOverlap().areOrthogonal().areAttachedToEndpoints().haveCrossing()).toBe(
			routes,
		);
		check.renderedPaths().haveBridgeAtEveryCrossing();
		check.renderedPaths(layout.relations).haveBridgeAtEveryCrossing();
		check.renderedPaths(layout.relations.map(({ id }) => id)).haveBridgeAtEveryCrossing();
		const first = check.routes(['a-to-c']);
		expect(
			first.haveNoCrossingWith(['b-to-d']).areAttachedToEndpoints().haveNoOverlapWith(['b-to-d']),
		).toBe(first);
		expect(() => check.route('missing')).toThrow('Missing layout route');
		expect(() => check.renderedPaths(['missing'])).toThrow('Missing layout route');
		expect(() => {
			check.renderedPaths([]).haveBridgeAtEveryCrossing();
		}).toThrow('at least two');
	},
);

it.each(Object.values(LayoutDirection))(
	'selects a single route without inferring its required shape in %s',
	async (direction) => {
		const layout = await layoutNodes({
			direction,
			...graphFixtures.routingNodes(['a', 'b'], direction).arrowsFrom('a', ['b']).build(),
		});
		const route = AssertLayout(layout).route('a-to-b');
		expect(
			route
				.isStraightAlong(axesFor(direction).primary)
				.isOrthogonal()
				.isAttachedTo(layout.getById('a'), layout.getById('b')),
		).toBe(route);
	},
);

it('detects a detached endpoint without weakening orthogonality or collection checks', async () => {
	const original = await layoutNodes({
		direction: LayoutDirection.TopToBottom,
		...graphFixtures
			.routingNodes(['a', 'b'], LayoutDirection.TopToBottom)
			.arrowsFrom('a', ['b'])
			.build(),
	});
	const detached = new VisualLayout({
		width: original.width,
		height: original.height,
		elements: original.elements,
		relations: original.relations.map((route) => ({
			...route,
			points: route.points.map((point) => ({ ...point, x: -100 })),
		})),
	});
	const routes = AssertLayout(detached).routes();
	expect(routes.areOrthogonal()).toBe(routes);
	expect(() => routes.areAttachedToEndpoints()).toThrow('not attached');
});

it('only requires a shared trunk for the explicitly selected route family', () => {
	const layout = new VisualLayout({
		width: 200,
		height: 200,
		elements: [{ id: 'a', kind: EndpointKind.Node, bounds: { x: 0, y: 0, width: 20, height: 20 } }],
		relations: [
			{
				id: 'left',
				from: 'a',
				to: 'b',
				points: [
					{ x: 10, y: 20 },
					{ x: 10, y: 50 },
					{ x: -20, y: 50 },
				],
			},
			{
				id: 'right',
				from: 'a',
				to: 'c',
				points: [
					{ x: 10, y: 20 },
					{ x: 10, y: 50 },
					{ x: 50, y: 50 },
				],
			},
		],
	});
	const check = AssertLayout(layout);
	check.trunks().haveSharedSegment('y', 30);
	check.trunks(['left', 'right']).haveSharedSegment('y', 30);
	check.trunks(layout.relations).haveSharedSegment('y', 30);
	expect(() => {
		check.trunks().haveSharedSegment('x', 1);
	}).toThrow('Longueur');
	expect(() => check.trunks([])).toThrow('au moins deux');
});
