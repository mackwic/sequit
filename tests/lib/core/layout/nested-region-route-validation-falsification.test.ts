import { describe, expect, it } from 'vitest';

import { defined } from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import { validateNestedRouteOwnership } from '../../../../src/lib/core/layout/nested-region-route-validation';
import {
	RegionCompositionStatus,
	type RegionInput,
	type RegionLayoutSelected,
} from '../../../../src/lib/core/layout/region-composition-types';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	nestedRegionInput,
	regionDocument,
	selectedNestedRegionLayout,
} from './nested-region-fixture';

function selectedWithUnrelatedNode() {
	const source = regionDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'b'));
	const document = {
		...source,
		nodes: [...source.nodes, { ...template, id: 'foreign', layoutOrder: orderKey('a4') }],
	};
	const base = nestedRegionInput();
	const input: RegionInput = {
		...base,
		regionByEndpointId: new Map([...base.regionByEndpointId, ['foreign', 'left']]),
	};
	const prepared = prepareLayoutDocument(document);
	const selected = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (selected.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected unrelated-node fixture: ${selected.reason}`);
	return { prepared, input, selected };
}

function selectedWithTwoParentRoutes() {
	const source = regionDocument();
	const middle = defined(source.nodes.find(({ id }) => id === 'b'));
	const document = {
		...source,
		nodes: [
			...source.nodes.filter(({ id }) => id !== 'a-source'),
			{ ...middle, id: 'b2', layoutOrder: orderKey('a4') },
		],
		relations: [
			{ id: 'left-to-middle', from: 'a-target', to: 'b' },
			{ id: 'middle-to-right', from: 'b2', to: 'c' },
		],
	};
	const base = nestedRegionInput();
	const regionByEndpointId = new Map(base.regionByEndpointId);
	regionByEndpointId.delete('a-source');
	regionByEndpointId.set('b2', 'middle');
	const input = { ...base, regionByEndpointId };
	const prepared = prepareLayoutDocument(document);
	const selected = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
	if (selected.status !== RegionCompositionStatus.Selected)
		throw new Error(`Expected selected two-route fixture: ${selected.reason}`);
	return { prepared, input, selected };
}

function replaceRoute(
	selected: RegionLayoutSelected,
	relationId: string,
	regionId: string,
	points: readonly { readonly x: number; readonly y: number }[],
): RegionLayoutSelected {
	const ownedRoutes = selected.ownedRoutes.map((piece) => {
		if (piece.relationId !== relationId || piece.regionId !== regionId) return piece;
		return { ...piece, points };
	});
	const chain = ownedRoutes
		.filter((piece) => piece.relationId === relationId)
		.flatMap((piece, index) => {
			if (index === 0) return piece.points;
			return piece.points.slice(1);
		});
	return {
		...selected,
		ownedRoutes,
		layout: {
			...selected.layout,
			relations: selected.layout.relations.map((route) => {
				if (route.id !== relationId) return route;
				return { ...route, points: chain };
			}),
		},
	};
}

describe('direct nested route diagnostics on selected layouts', () => {
	it('rejects a missing source node even when the published node count still matches', () => {
		const { prepared, result } = selectedNestedRegionLayout();
		const input = nestedRegionInput();
		expect(validateNestedRouteOwnership(prepared.graph, input, result)).toBeUndefined();
		const invalid: RegionLayoutSelected = {
			...result,
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== 'a-target') return element;
					return { ...element, id: 'unrelated', bounds: { ...element.bounds, x: -1000 } };
				}),
			},
		};
		expect(validateNestedRouteOwnership(prepared.graph, input, invalid)).toBe(
			'Relation across-middle does not attach to its source port.',
		);
	});

	it('rejects a locally owned route crossing a foreign node in the same leaf', () => {
		const { prepared, input, selected } = selectedWithUnrelatedNode();
		expect(validateNestedRouteOwnership(prepared.graph, input, selected)).toBeUndefined();
		const left = defined(selected.regions.find(({ id }) => id === 'left'));
		const foreign = defined(selected.layout.elements.find(({ id }) => id === 'foreign'));
		const local = defined(left.localLayout.relations.find(({ id }) => id === 'inside-a'));
		const offset = left.translation;
		const start = {
			x: defined(local.points[0]).x + offset.x,
			y: defined(local.points[0]).y + offset.y,
		};
		const end = {
			x: defined(local.points.at(-1)).x + offset.x,
			y: defined(local.points.at(-1)).y + offset.y,
		};
		const center = {
			x: foreign.bounds.x + foreign.bounds.width / 2,
			y: foreign.bounds.y + foreign.bounds.height / 2,
		};
		const points = [start, { x: center.x, y: start.y }, center, { x: end.x, y: center.y }, end];
		const withOwnedRoute = replaceRoute(selected, 'inside-a', 'left', points);
		const invalid: RegionLayoutSelected = {
			...withOwnedRoute,
			regions: withOwnedRoute.regions.map((region) => {
				if (region.id !== 'left') return region;
				return {
					...region,
					localLayout: {
						...region.localLayout,
						relations: region.localLayout.relations.map((route) => {
							if (route.id !== 'inside-a') return route;
							return {
								...route,
								points: points.map(({ x, y }) => ({ x: x - offset.x, y: y - offset.y })),
							};
						}),
					},
				};
			}),
		};
		expect(validateNestedRouteOwnership(prepared.graph, input, invalid)).toBe(
			'Relation inside-a crosses unrelated node foreign.',
		);
	});

	it('rejects two parent-owned routes touching without a bridge', () => {
		const { prepared, input, selected } = selectedWithTwoParentRoutes();
		expect(validateNestedRouteOwnership(prepared.graph, input, selected)).toBeUndefined();
		const first = defined(
			selected.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'left-to-middle' && regionId === '@root',
			),
		);
		const second = defined(
			selected.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'middle-to-right' && regionId === '@root',
			),
		);
		const start = defined(second.points[0]);
		const end = defined(second.points.at(-1));
		const crossing = defined(first.points[1]);
		const points = [
			start,
			{ x: start.x, y: crossing.y },
			{ x: crossing.x, y: crossing.y },
			{ x: end.x, y: crossing.y },
			end,
		];
		const invalid = replaceRoute(selected, second.relationId, '@root', points);
		expect(validateNestedRouteOwnership(prepared.graph, input, invalid)).toBe(
			'Parent routes left-to-middle and middle-to-right intersect without a bridge.',
		);
	});
});
