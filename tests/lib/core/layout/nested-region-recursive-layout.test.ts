import { describe, expect, it } from 'vitest';

import {
	defined,
	LayoutBias,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import { NestedRegionLocalLayoutCache } from '../../../../src/lib/core/layout/nested-region-local-cache';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-recursive-layout';
import {
	NestedPortalSide,
	type NestedRegionInput,
	NestedRegionLayoutStatus,
} from '../../../../src/lib/core/layout/nested-region-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	depthTwoRegionDocument,
	depthTwoRegionInput,
	nestedRegionInput,
	regionDocument,
} from './nested-region-fixture';

function depthThreeFixture(
	direction: LayoutDirection,
	bias: LayoutBias,
): {
	readonly document: LogicDocument;
	readonly input: NestedRegionInput;
} {
	const source = depthTwoRegionDocument();
	const c = defined(source.nodes.find(({ id }) => id === 'c'));
	const document: LogicDocument = {
		...source,
		layout: defined(layoutConfiguration(direction, bias)),
		nodes: [...source.nodes, { ...c, id: 'f', markdown: 'F\n', layoutOrder: orderKey('a6') }],
		relations: [
			defined(source.relations.find(({ id }) => id === 'inside-a')),
			{ id: 'deep-to-right', from: 'c', to: 'd' },
		],
	};
	const base = depthTwoRegionInput();
	const assignments = new Map(base.regionByEndpointId);
	assignments.set('c', 'deep-left');
	assignments.set('f', 'deep-right');
	const input: NestedRegionInput = {
		regions: [
			...base.regions,
			{ id: 'deep-left', parentId: 'branch-right', layoutOrder: 'a' },
			{ id: 'deep-right', parentId: 'branch-right', layoutOrder: 'b' },
		],
		regionByEndpointId: assignments,
	};
	return { document, input };
}

describe('recursive row disposition', () => {
	it.each([
		[LayoutDirection.TopToBottom, LayoutBias.Top],
		[LayoutDirection.BottomToTop, LayoutBias.Bottom],
		[LayoutDirection.LeftToRight, LayoutBias.Left],
		[LayoutDirection.RightToLeft, LayoutBias.Right],
	] as const)(
		'publishes the recursive candidate through the production facade in %s',
		(direction, bias) => {
			const source = regionDocument();
			const document = {
				...source,
				layout: defined(layoutConfiguration(direction, bias)),
			};
			const prepared = prepareLayoutDocument(document);
			const input = nestedRegionInput();
			const production = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
			const recursive = solveRecursiveNestedRegionLayout(
				prepared.graph,
				prepared.measurements,
				input,
			);
			expect(recursive.status).toBe(NestedRegionLayoutStatus.Selected);
			expect(production.status).toBe(NestedRegionLayoutStatus.Selected);
			if (recursive.status !== NestedRegionLayoutStatus.Selected) return;
			if (production.status !== NestedRegionLayoutStatus.Selected) return;
			expect(production).toEqual(recursive);
		},
	);

	it('reuses unaffected depth-three leaves and matches a cold recomposition after a local edit', () => {
		const { document, input } = depthThreeFixture(LayoutDirection.TopToBottom, LayoutBias.Top);
		const prepared = prepareLayoutDocument(document);
		const cache = new NestedRegionLocalLayoutCache();
		const first = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(first.status).toBe(NestedRegionLayoutStatus.Selected);
		expect(cache.stats).toMatchObject({ misses: 6, hits: 0 });
		const changedSizes = new Map(prepared.measurements.nodes);
		const c = defined(changedSizes.get('c'));
		changedSizes.set('c', { ...c, width: c.width + 5 });
		const changed = { ...prepared.measurements, nodes: changedSizes };
		const incremental = solveRecursiveNestedRegionLayout(prepared.graph, changed, input, cache);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, changed, input);
		expect(incremental).toEqual(cold);
		expect(incremental.status).toBe(NestedRegionLayoutStatus.Selected);
		expect(cache.stats).toMatchObject({ misses: 7, hits: 5 });
	});

	it('resolves an incident through each boundary of a two-level tree', () => {
		const source = depthTwoRegionDocument();
		const document = {
			...source,
			relations: [
				defined(source.relations.find(({ id }) => id === 'inside-a')),
				{ id: 'grandchild-to-right', from: 'c', to: 'd' },
			],
		};
		const prepared = prepareLayoutDocument(document);
		const result = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			depthTwoRegionInput(),
		);
		expect(result.status).toBe(NestedRegionLayoutStatus.Selected);
		if (result.status !== NestedRegionLayoutStatus.Selected) return;
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'grandchild-to-right')
				.map(({ regionId }) => regionId),
		).toEqual(['branch-right', 'branch', '@root', 'right']);
	});

	it.each([
		[LayoutDirection.TopToBottom, LayoutBias.Top, NestedPortalSide.Top],
		[LayoutDirection.BottomToTop, LayoutBias.Bottom, NestedPortalSide.Bottom],
	] as const)(
		'resolves a depth-three incident through four boundaries in %s',
		(direction, bias, side) => {
			const { document, input } = depthThreeFixture(direction, bias);
			const prepared = prepareLayoutDocument(document);
			const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
			if (result.status !== NestedRegionLayoutStatus.Selected)
				throw new Error(`Expected selected depth-three layout: ${result.status}: ${result.reason}`);
			const regionIds = result.regions.map(({ id }) => id);
			expect(regionIds).toHaveLength(8);
			expect(new Set(regionIds).size).toBe(8);
			const portals = result.portals.filter(({ relationId }) => relationId === 'deep-to-right');
			expect(portals.map(({ regionId }) => regionId)).toEqual([
				'deep-left',
				'branch-right',
				'branch',
				'right',
			]);
			expect(portals.map(({ side: portalSide }) => portalSide)).toEqual([side, side, side, side]);
			expect(
				result.ownedRoutes
					.filter(({ relationId }) => relationId === 'deep-to-right')
					.map(({ regionId }) => regionId),
			).toEqual(['deep-left', 'branch-right', 'branch', '@root', 'right']);
			const route = defined(result.layout.relations.find(({ id }) => id === 'deep-to-right'));
			for (const portal of portals) expect(route.points).toContainEqual(portal.point);
			const normalized = normalizeRegionCompositionModel(prepared.graph, input);
			expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
			if (normalized.status !== RegionCompositionModelStatus.Ready) return;
			expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();

			const permuted = {
				...document,
				nodes: [...document.nodes].reverse(),
				relations: [...document.relations].reverse(),
			};
			const repeated = prepareLayoutDocument(permuted);
			expect(
				solveRecursiveNestedRegionLayout(repeated.graph, repeated.measurements, {
					regions: [...input.regions].reverse(),
					regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
				}),
			).toEqual(result);
		},
	);
});
