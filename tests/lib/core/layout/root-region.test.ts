import { describe, expect, it } from 'vitest';

import {
	LayoutBias,
	LayoutDirection,
	LayoutPolicy,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { createGraph } from '../../../../src/lib/core/graph/create-graph';
import { topologicallyRank } from '../../../../src/lib/core/graph/topological-ranks';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grid-cell-layout';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grid-cell-validation';
import { layoutWithDedicatedEngine } from '../../../../src/lib/core/layout/layout-engine';
import { solveNestedRegionLayout } from '../../../../src/lib/core/layout/nested-region-layout';
import { pathsTouchWithoutBridge } from '../../../../src/lib/core/layout/nested-region-leaf-incident-contacts';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/region-composition-model';
import { RegionCompositionStatus } from '../../../../src/lib/core/layout/region-composition-types';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/region-composition-validation';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/region-geometry-diagnostic';
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
import { gridInput, persistedGridDocument, prepareGrid } from './grid-cell-fixture';
import {
	persistedNestedGridDocument,
	persistedNestedGridWithLaneCellDocument,
	persistedRegionDocument,
	regionDocument,
} from './nested-region-fixture';

describe('implicit root layout region', () => {
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

	it('rejects an unbridged contact between three persisted root grid crossings', () => {
		const source = persistedGridDocument();
		const prepared = prepareGrid({
			...source,
			relations: [
				...source.relations,
				{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
				{ id: 'third-crossing', from: 'a-top', to: 'd' },
			],
		});
		const attempt = solveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nestedRegionInput(prepared.graph),
		);
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: '@root',
			relationId: 'across-grid',
		});
		let failure: unknown;
		try {
			layoutWithRootRegion(prepared.graph, prepared.ranks, prepared.measurements);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(UnknownGridCellLayoutError);
		expect(failure).toMatchObject({
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: '@root',
			relationId: 'across-grid',
		});
	});

	it('rejects an unbridged group crossing that the old grid checker accepted', () => {
		const source = persistedGridDocument();
		const extraCrossing = prepareGrid({
			...source,
			relations: [...source.relations, { id: 'group-crossing', from: 'oversized', to: 'd' }],
		});
		const attempt = solveNestedRegionLayout(
			extraCrossing.graph,
			extraCrossing.measurements,
			nestedRegionInput(extraCrossing.graph),
		);
		expect(attempt).toMatchObject({
			status: RegionCompositionStatus.Unknown,
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: '@root',
		});
		expect(() =>
			layoutWithRootRegion(extraCrossing.graph, extraCrossing.ranks, extraCrossing.measurements),
		).toThrow(UnknownGridCellLayoutError);
		const baseInput = gridInput();
		const input = {
			...baseInput,
			cells: baseInput.cells.map(({ id, parentId, row, column }) => ({
				id,
				parentId,
				row,
				column,
			})),
		};
		const selected = solveGridCellLayout(extraCrossing.graph, extraCrossing.measurements, input);
		expect(selected.status).toBe(GridCellLayoutStatus.Selected);
		if (selected.status !== GridCellLayoutStatus.Selected) return;
		expect(validateGridCellGeometry(selected, extraCrossing.graph, input)).toBeUndefined();
		const layout = selected.layout;
		const across = layout.relations.find(({ id }) => id === 'across-grid');
		const groupCrossing = layout.relations.find(({ id }) => id === 'group-crossing');
		if (across === undefined || groupCrossing === undefined)
			throw new Error('Expected both grid crossings');
		expect(pathsTouchWithoutBridge(across.points, groupCrossing.points)).toBe(true);
		const group = layout.elements.find(({ id }) => id === 'oversized');
		const member = layout.elements.find(({ id }) => id === 'b');
		const port = layout.relations.find(({ id }) => id === 'group-crossing')?.points[0];
		if (group === undefined || member === undefined || port === undefined)
			throw new Error('Expected the group crossing geometry');
		expect(port.x).toBe(group.bounds.x + group.bounds.width);
		expect(port.y).toBeGreaterThan(group.bounds.y);
		expect(port.y).toBeLessThan(group.bounds.y + group.bounds.height);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);

		const groupedEndpoint = prepareGrid({
			...source,
			relations: [...source.relations, { id: 'grouped-crossing', from: 'b', to: 'd' }],
		});
		let groupedFailure: unknown;
		try {
			layoutWithRootRegion(
				groupedEndpoint.graph,
				groupedEndpoint.ranks,
				groupedEndpoint.measurements,
			);
		} catch (error) {
			groupedFailure = error;
		}
		expect(groupedFailure).toBeInstanceOf(UnknownGridCellLayoutError);
		expect(groupedFailure).toMatchObject({
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
			regionId: '@root',
		});

		const blocked = prepareGrid({
			...source,
			layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
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

	it('reports a fourth direct child as outside the bounded composition', () => {
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
