import { describe, expect, it } from 'vitest';

import {
	defined,
	GRID_PERSISTENCE_FORMAT,
	GRID_REGION_PRESENTATION_SCHEMA,
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { entersInterior } from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import type { LayoutRelation, LayoutResult } from '../../../../src/lib/core/layout/layout-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-layout';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import {
	LayoutRegionKind,
	LayoutRegionPolicy,
	layoutWithRootRegion,
	nestedRegionInput,
	normalizeRootRegion,
	UnknownGridCellLayoutError,
	UnsupportedGridCellLayoutError,
	UnsupportedLayoutPresentationError,
	UnsupportedRegionLayoutError,
} from '../../../../src/lib/core/layout/root-region';
import {
	LAYOUT_CONFIGURATIONS,
	layoutBiasScenario,
} from '../../../support/builders/layout-bias-scenario';
import {
	explicitLaneLogicDocument,
	validLogicDocument,
} from '../../../support/builders/logic-document';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { gridOf } from '../../../support/performance/layout-resource-scenarios';
import { gridInput, persistedGridDocument, prepareGrid } from './grid-cell-fixture';
import {
	persistedNestedGridDocument,
	persistedNestedGridWithLaneCellDocument,
	persistedRegionDocument,
	regionDocument,
} from './nested-region-fixture';

/** Opacity witness: no segment of the route enters a foreign cell. */
function foreignCellEntry(
	layout: LayoutResult,
	route: LayoutRelation,
	foreign: readonly string[],
): string | undefined {
	for (const id of foreign) {
		const cell = layout.regions?.find((region) => region.id === id);
		if (cell === undefined) throw new Error(`Missing cell ${id}`);
		for (let index = 0; index < route.points.length - 1; index += 1)
			if (
				entersInterior(defined(route.points[index]), defined(route.points[index + 1]), cell.bounds)
			)
				return id;
	}
	return undefined;
}

function persistedGridOf(document: LogicDocument, input: GridCellInput): LogicDocument {
	return {
		...document,
		persistenceFormat: GRID_PERSISTENCE_FORMAT,
		regionPresentation: {
			schemaVersion: GRID_REGION_PRESENTATION_SCHEMA,
			regions: input.cells.map(({ id }, index) => ({
				id,
				layoutOrder: orderKey(`a${index.toString().padStart(3, '0')}V`),
				policy: LayoutPolicy.Layered,
			})),
			grid: {
				minimumColumnWidths: input.minimumColumnWidths,
				minimumRowHeights: input.minimumRowHeights,
				cells: input.cells.map(({ id, row, column }) => ({ regionId: id, row, column })),
			},
		},
		nodes: document.nodes.map((node) => ({
			...node,
			regionId: defined(input.cellByEndpointId.get(node.id)),
		})),
	};
}

describe('implicit root layout region', () => {
	it('selects a persisted 3×7 grid with 21 endpoints through the product entry', () => {
		const { document, input } = gridOf(3, 7);
		const prepared = prepareLayoutDocument(persistedGridOf(document, input));
		expect(normalizeRootRegion(prepared.graph, prepared.ranks).policy).toBe(
			LayoutRegionPolicy.GridCells,
		);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout.regions).toHaveLength(21);
		expect(layout.elements).toHaveLength(21);
	});

	it(
		'selects a persisted 6×6 grid with thirty local relations through the product entry',
		() => {
			const { document, input } = gridOf(6, 6);
			const populated = {
				...document,
				nodes: [
					...document.nodes,
					...document.nodes.slice(0, 30).map((node) => ({
						...node,
						id: `local-${node.id}`,
						layoutOrder: orderKey('a9999'),
					})),
				],
				relations: document.nodes.slice(0, 30).map((node) => ({
					id: `local-${node.id}`,
					from: node.id,
					to: `local-${node.id}`,
				})),
			};
			const ownership = new Map(input.cellByEndpointId);
			for (const node of document.nodes.slice(0, 30))
				ownership.set(`local-${node.id}`, defined(input.cellByEndpointId.get(node.id)));
			const prepared = prepareLayoutDocument(
				persistedGridOf(populated, { ...input, cellByEndpointId: ownership }),
			);
			expect(normalizeRootRegion(prepared.graph, prepared.ranks).policy).toBe(
				LayoutRegionPolicy.GridCells,
			);
			const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
			expect(layout.regions).toHaveLength(36);
			expect(layout.elements).toHaveLength(66);
			expect(layout.relations).toHaveLength(30);
		},
	);

	it('normalizes a legacy document as one virtual region borrowing its graph and ranks', () => {
		const prepared = prepareLayoutDocument(validLogicDocument());
		const region = normalizeRootRegion(prepared.graph, prepared.ranks);

		expect(region.kind).toBe(LayoutRegionKind.Root);
		expect(region.documentId).toBe(prepared.document.id);
		expect(region.policy).toBe(LayoutRegionPolicy.Dedicated);
		expect(region.graph).toBe(prepared.graph);
		expect(region.ranks).toBe(prepared.ranks);
		expect(region.graph.document).toBe(prepared.document);
		const input = nestedRegionInput(prepared.graph);
		expect(input.regions).toEqual([
			{ id: '@root', layoutOrder: 'a0', policy: LayoutPolicy.Layered },
		]);
		expect(new Set(input.regionByEndpointId.values())).toEqual(new Set(['@root']));
		expect(input.regionByEndpointId.size).toBe(prepared.graph.endpointsById.size);
	});

	it.each(LAYOUT_CONFIGURATIONS)(
		'preserves the complete result for $direction with $bias bias',
		(layout) => {
			const prepared = prepareLayoutDocument(layoutBiasScenario(layout, 'subgroup'));
			const inputs = structuredClone(prepared);
			const original = layoutWithDedicatedEngine(
				prepared.graph,
				prepared.ranks,
				prepared.measurements,
				{ inspectRouting: true },
			);

			expect(
				layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements, {
					inspectRouting: true,
				}),
			).toEqual(original);
			expect(prepared).toEqual(inputs);
		},
	);

	it('preserves the grouped junction policy without inspection', () => {
		const prepared = prepareLayoutDocument(validLogicDocument());
		expect(layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements)).toEqual(
			layoutWithDedicatedEngine(prepared.graph, prepared.ranks, prepared.measurements),
		);
	});

	it('rejects explicit lanes until a shared layout policy is available', () => {
		const prepared = prepareLayoutDocument(explicitLaneLogicDocument());
		expect(() =>
			layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements),
		).toThrow(UnsupportedLayoutPresentationError);
	});

	it('dispatches persisted child regions to local layouts and publishes their frames', () => {
		const prepared = prepareLayoutDocument(persistedRegionDocument());
		expect(normalizeRootRegion(prepared.graph, prepared.ranks).policy).toBe(
			LayoutRegionPolicy.NestedRegions,
		);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout.regions?.map(({ id }) => id)).toEqual(['left', 'middle', 'right']);
		expect(layout.elements.map(({ id }) => id)).toEqual(['a-source', 'a-target', 'b', 'c']);
		expect(layout.relations.map(({ id }) => id)).toEqual(['across-middle', 'inside-a']);
	});

	it('dispatches persisted grid cells through the root policy and publishes four frames', () => {
		const prepared = prepareGrid(persistedGridDocument());
		expect(normalizeRootRegion(prepared.graph, prepared.ranks).policy).toBe(
			LayoutRegionPolicy.GridCells,
		);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		const direct = solveGridCellLayout(prepared.graph, prepared.measurements, gridInput());
		if (direct.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected direct grid layout: ${direct.status}: ${direct.reason}`);
		expect(layout).toEqual(direct.layout);
		expect(layout.regions?.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
		expect(layout.elements.map(({ id }) => id)).toEqual([
			'a-bottom',
			'a-top',
			'b',
			'c',
			'd',
			'oversized',
		]);
		expect(layout.relations.map(({ id }) => id)).toEqual(['across-grid', 'inside-a']);
	});

	it('dispatches a persisted internal grid through recursive composition', () => {
		const prepared = prepareLayoutDocument(persistedNestedGridDocument());
		expect(normalizeRootRegion(prepared.graph, prepared.ranks).policy).toBe(
			LayoutRegionPolicy.NestedRegions,
		);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout.regions?.map(({ id }) => id)).toEqual(['grid', 'a', 'b', 'c', 'd', 'outside']);
		expect(layout.relations.map(({ id }) => id)).toEqual(['across-grid', 'inside-a']);
		const grid = layout.regions?.find(({ id }) => id === 'grid');
		expect(grid?.bounds.width).toBeGreaterThanOrEqual(800);
	});

	it('keeps four internal grid cells with no intercell relation', () => {
		const source = persistedNestedGridDocument();
		const document = {
			...source,
			relations: source.relations.filter(({ id }) => id === 'inside-a'),
		};
		const prepared = prepareLayoutDocument(document);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout.regions?.map(({ id }) => id)).toEqual(['grid', 'a', 'b', 'c', 'd', 'outside']);
		expect(layout.relations.map(({ id }) => id)).toEqual(['inside-a']);
		expect(layout.elements.map(({ id }) => id)).toEqual([
			'a-source',
			'a-target',
			'b',
			'c',
			'd',
			'outside',
		]);
	});

	it('publishes a cell-local lane layout through the persisted grid', () => {
		const prepared = prepareLayoutDocument(persistedNestedGridWithLaneCellDocument());
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout.lanes?.map(({ id, regionId }) => [id, regionId])).toEqual([
			['left', 'b'],
			['right', 'b'],
		]);
		expect(layout.relations.map(({ id }) => id)).toEqual(['across-grid', 'inside-a', 'inside-b']);
	});

	it('selects an unbridged three-route contact by reallocating the exterior rails', () => {
		const source = persistedGridDocument();
		const prepared = prepareGrid({
			...source,
			relations: [
				...source.relations,
				{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
				{ id: 'third-crossing', from: 'a-top', to: 'd' },
			],
		});
		const input = nestedRegionInput(prepared.graph);
		const attempt = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(layout).toEqual(attempt.layout);
		const routes = new Map(layout.relations.map((route) => [route.id, route]));
		const across = defined(routes.get('across-grid'));
		const second = defined(routes.get('second-crossing'));
		const third = defined(routes.get('third-crossing'));
		expect(across.points[0]).not.toEqual(second.points[0]);
		expect(across.points.at(-1)).not.toEqual(third.points.at(-1));
		expect(foreignCellEntry(layout, across, ['b', 'c'])).toBeUndefined();
		expect(foreignCellEntry(layout, second, ['b', 'd'])).toBeUndefined();
		expect(foreignCellEntry(layout, third, ['b', 'c'])).toBeUndefined();
	});

	it('selects an unbridged group crossing that the old grid checker rejected', () => {
		const source = persistedGridDocument();
		const extraCrossing = prepareGrid({
			...source,
			relations: [...source.relations, { id: 'group-crossing', from: 'oversized', to: 'd' }],
		});
		const input = nestedRegionInput(extraCrossing.graph);
		const attempt = solveNestedRegionLayout(extraCrossing.graph, extraCrossing.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(extraCrossing.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		const layout = layoutWithRootRegion(
			extraCrossing.graph,
			extraCrossing.ranks,
			extraCrossing.measurements,
		);
		expect(layout).toEqual(attempt.layout);
		const across = defined(layout.relations.find(({ id }) => id === 'across-grid'));
		const groupCrossing = defined(layout.relations.find(({ id }) => id === 'group-crossing'));
		expect(across.points.at(-1)).not.toEqual(groupCrossing.points.at(-1));
		const group = defined(layout.elements.find(({ id }) => id === 'oversized'));
		const member = defined(layout.elements.find(({ id }) => id === 'b'));
		const port = defined(groupCrossing.points[0]);
		expect(port.x).toBe(group.bounds.x + group.bounds.width);
		expect(port.y).toBeGreaterThan(group.bounds.y);
		expect(port.y).toBeLessThan(group.bounds.y + group.bounds.height);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(foreignCellEntry(layout, groupCrossing, ['a', 'c'])).toBeUndefined();
		expect(foreignCellEntry(layout, across, ['b', 'c'])).toBeUndefined();

		const groupedEndpoint = prepareGrid({
			...source,
			relations: [...source.relations, { id: 'grouped-crossing', from: 'b', to: 'd' }],
		});
		const groupedInput = nestedRegionInput(groupedEndpoint.graph);
		const grouped = solveNestedRegionLayout(
			groupedEndpoint.graph,
			groupedEndpoint.measurements,
			groupedInput,
		);
		expect(grouped.status).toBe(RegionCompositionStatus.Selected);
		if (grouped.status !== RegionCompositionStatus.Selected) return;
		const groupedModel = normalizeRegionCompositionModel(groupedEndpoint.graph, groupedInput);
		if (groupedModel.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(groupedModel.model, grouped)).toBeUndefined();
		const groupedLayout = layoutWithRootRegion(
			groupedEndpoint.graph,
			groupedEndpoint.ranks,
			groupedEndpoint.measurements,
		);
		const groupedRoute = defined(
			groupedLayout.relations.find(({ id }) => id === 'grouped-crossing'),
		);
		const groupedMember = defined(groupedLayout.elements.find(({ id }) => id === 'b'));
		const groupedPort = defined(groupedRoute.points[0]);
		expect(groupedPort.x).toBe(groupedMember.bounds.x + groupedMember.bounds.width);
		expect(foreignCellEntry(groupedLayout, groupedRoute, ['a', 'c'])).toBeUndefined();

		const blocked = prepareGrid({
			...source,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			relations: [...source.relations, { id: 'group-crossing', from: 'oversized', to: 'd' }],
		});
		expect(() => layoutWithRootRegion(blocked.graph, blocked.ranks, blocked.measurements)).toThrow(
			UnknownGridCellLayoutError,
		);
	});

	it('rejects a grid presentation whose cell or region hierarchy was changed after validation', () => {
		const prepared = prepareGrid(persistedGridDocument());
		const source = prepared.document;
		const presentation = source.regionPresentation;
		if (presentation?.grid === undefined) throw new Error('Expected a grid presentation');
		const altered = [
			{
				...source,
				regionPresentation: {
					...presentation,
					grid: {
						...presentation.grid,
						cells: presentation.grid.cells.map((cell) => {
							if (cell.regionId === 'a') return { ...cell, regionId: 'ghost' };
							return cell;
						}),
					},
				},
			},
			{
				...source,
				regionPresentation: {
					...presentation,
					regions: [
						...presentation.regions,
						{ id: 'extra', layoutOrder: orderKey('a5'), policy: LayoutPolicy.Layered },
					],
				},
			},
			{
				...source,
				nodes: source.nodes.map((node) => {
					if (node.id === 'c') return { ...node, regionId: 'ghost' };
					return node;
				}),
			},
		];
		for (const document of altered) {
			const graph = createGraph(document);
			if (!graph.ok) throw new Error('Expected an acyclic graph');
			expect(() =>
				layoutWithRootRegion(graph.value, topologicallyRank(graph.value), prepared.measurements),
			).toThrow(UnsupportedGridCellLayoutError);
		}
	});

	it('selects a crossing after the bounded side retry and validates its geometry', () => {
		const prepared = prepareLayoutDocument(persistedRegionDocument(regionDocument('a-source')));
		const input = nestedRegionInput(prepared.graph);
		const selected = solveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected crossing: ${selected.status}: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized region composition');
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		expect(
			layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements).relations,
		).toEqual(selected.layout.relations);
	});

	it('rejects a fourth direct child that owns no endpoint', () => {
		const document = persistedRegionDocument();
		const prepared = prepareLayoutDocument({
			...document,
			regionPresentation: {
				...document.regionPresentation,
				regions: [
					...document.regionPresentation.regions,
					{ id: 'fourth', layoutOrder: orderKey('a3'), policy: LayoutPolicy.Layered },
				],
			},
		});
		expect(() =>
			layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements),
		).toThrow(UnsupportedRegionLayoutError);
	});

	it('selects a fourth direct child that owns its endpoint', () => {
		const document = persistedRegionDocument();
		const template = defined(document.nodes[0]);
		const withFourth = {
			...document,
			regionPresentation: {
				...document.regionPresentation,
				regions: [
					...document.regionPresentation.regions,
					{ id: 'fourth', layoutOrder: orderKey('a3'), policy: LayoutPolicy.Layered },
				],
			},
			nodes: [
				...document.nodes,
				{
					...template,
					id: 'd',
					markdown: 'D\n',
					layoutOrder: orderKey('a4'),
					regionId: 'fourth',
				},
			],
			relations: [...document.relations, { id: 'across-fourth', from: 'a-target', to: 'd' }],
		};
		const prepared = prepareLayoutDocument(withFourth);
		const layout = layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		expect(
			(layout.regions ?? [])
				.map(({ id }) => id)
				.filter((id) => ['left', 'middle', 'right', 'fourth'].includes(id))
				.sort(),
		).toEqual(['fourth', 'left', 'middle', 'right']);
	});

	it('rejects root-owned nodes and invalid region references explicitly', () => {
		const document = persistedRegionDocument();
		const prepared = prepareLayoutDocument({
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id === 'b') {
					return {
						kind: node.kind,
						id: node.id,
						natureId: node.natureId,
						markdown: node.markdown,
						layoutOrder: node.layoutOrder,
					};
				}
				return node;
			}),
		});
		expect(() =>
			layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements),
		).toThrow(UnsupportedRegionLayoutError);

		const invalid = {
			...document,
			nodes: document.nodes.map((node) => {
				if (node.id === 'b') return { ...node, regionId: 'missing' };
				return node;
			}),
		};
		const graph = createGraph(invalid);
		if (!graph.ok) throw new Error('Expected an acyclic graph');
		expect(() =>
			layoutWithRootRegion(graph.value, topologicallyRank(graph.value), prepared.measurements),
		).toThrow(UnsupportedRegionLayoutError);
	});
});
