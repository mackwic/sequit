import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	JunctionOperator,
	LaneGrowth,
	LaneOrientation,
	LayoutBias,
	type LayoutConfiguration,
	LayoutDirection,
	LayoutPolicy,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import { within } from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	type RegionInput,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { RegionLocalLayoutCache } from '../../../../src/lib/core/layout/regions/model/region-local-cache';
import { RegionSearchProvenance } from '../../../../src/lib/core/layout/regions/model/region-search-evidence';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import {
	RegionSubtreeScope,
	solveRegionSubtreeAttempts,
} from '../../../../src/lib/core/layout/regions/recursive/region-partial-composition';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { diagnoseParentRouteContacts } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation-detail';
import { PROPERTY_PARAMETERS } from '../../../support/builders/property-test-options';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import { persistedNestedGridDocument, regionDocument } from './nested-region-fixture';

function nestedGridFixture(): {
	readonly document: LogicDocument;
	readonly input: RegionInput;
} {
	const source = regionDocument();
	const template = defined(source.nodes.find(({ id }) => id === 'c'));
	const document: LogicDocument = {
		...source,
		nodes: [
			...source.nodes,
			{ ...template, id: 'd', markdown: 'D\n', layoutOrder: orderKey('a4') },
			{ ...template, id: 'outside', markdown: 'Outside\n', layoutOrder: orderKey('a5') },
		],
		relations: [
			{ id: 'inside-a', from: 'a-source', to: 'a-target' },
			{ id: 'across-grid', from: 'a-target', to: 'd' },
		],
	};
	const input: RegionInput = {
		regions: [
			{ id: '@root', layoutOrder: '0' },
			{
				id: 'grid',
				parentId: '@root',
				layoutOrder: 'a',
				grid: {
					minimumColumnWidths: [700, 100],
					minimumRowHeights: [50, 300],
					cells: [
						{ regionId: 'a', row: 0, column: 0 },
						{ regionId: 'b', row: 0, column: 1 },
						{ regionId: 'c', row: 1, column: 0 },
						{ regionId: 'd', row: 1, column: 1 },
					],
				},
			},
			{ id: 'outside', parentId: '@root', layoutOrder: 'b' },
			{ id: 'a', parentId: 'grid', layoutOrder: 'a' },
			{ id: 'b', parentId: 'grid', layoutOrder: 'b' },
			{ id: 'c', parentId: 'grid', layoutOrder: 'c' },
			{ id: 'd', parentId: 'grid', layoutOrder: 'd' },
		],
		regionByEndpointId: new Map([
			['a-source', 'a'],
			['a-target', 'a'],
			['b', 'b'],
			['c', 'c'],
			['d', 'd'],
			['outside', 'outside'],
		]),
	};
	return { document, input };
}

function twoOuterRegionsFixture(): {
	readonly document: LogicDocument;
	readonly input: RegionInput;
} {
	const { document, input } = nestedGridFixture();
	const outside = defined(document.nodes.find(({ id }) => id === 'outside'));
	return {
		document: {
			...document,
			nodes: [
				...document.nodes,
				{ ...outside, id: 'outside-2', markdown: 'Outside 2\n', layoutOrder: orderKey('a6') },
			],
			relations: [defined(document.relations.find(({ id }) => id === 'inside-a'))],
		},
		input: {
			...input,
			regions: [
				...input.regions.map((region) => {
					if (region.id === 'outside') return { ...region, layoutOrder: 'c' };
					return region;
				}),
				{ id: 'outside-2', parentId: '@root', layoutOrder: 'b' },
			],
			regionByEndpointId: new Map([...input.regionByEndpointId, ['outside-2', 'outside-2']]),
		},
	};
}

function directGridInput(input: RegionInput): GridCellInput {
	const grid = defined(input.regions.find(({ id }) => id === 'grid')?.grid);
	return {
		rootId: 'grid',
		cells: grid.cells.map(({ regionId, row, column }) => ({
			id: regionId,
			parentId: 'grid',
			row,
			column,
		})),
		cellByEndpointId: new Map(
			[...input.regionByEndpointId].filter(([, regionId]) => regionId !== 'outside'),
		),
		minimumColumnWidths: grid.minimumColumnWidths,
		minimumRowHeights: grid.minimumRowHeights,
	};
}

describe('a grid disposition inside the recursive region tree', () => {
	it('places four opaque cells beside an ordinary region and preserves their local grid solve', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument(document);
		const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const grid = defined(result.regions.find(({ id }) => id === 'grid'));
		expect(result.regions.map(({ id }) => id)).toEqual(['grid', 'a', 'b', 'c', 'd', 'outside']);
		expect(result.portals.filter(({ relationId }) => relationId === 'across-grid')).toHaveLength(2);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'across-grid')
				.map(({ regionId }) => regionId),
		).toEqual(['a', 'grid', 'd']);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
		if (normalized.status !== RegionCompositionModelStatus.Ready) return;
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();

		const localDocument = {
			...document,
			nodes: document.nodes.filter(({ id }) => id !== 'outside'),
		};
		const local = prepareLayoutDocument(localDocument);
		const direct = solveGridCellLayout(local.graph, local.measurements, directGridInput(input));
		expect(direct.status).toBe(GridCellLayoutStatus.Selected);
		if (direct.status !== GridCellLayoutStatus.Selected) return;
		expect(grid.localLayout).toEqual(direct.layout);
	});

	it('keeps the recursive result deterministic under source and region permutations', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument(document);
		const baseline = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		const permuted = prepareLayoutDocument({
			...document,
			nodes: [...document.nodes].reverse(),
			relations: [...document.relations].reverse(),
		});
		expect(
			solveRecursiveNestedRegionLayout(permuted.graph, permuted.measurements, {
				regions: [...input.regions].reverse(),
				regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
			}),
		).toEqual(baseline);
	});

	it('reuses unchanged leaves after a grid track minimum grows and equals a cold solve', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument(document);
		const cache = new RegionLocalLayoutCache();
		const original = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(original.status).toBe(RegionCompositionStatus.Selected);
		expect(cache.stats).toMatchObject({ misses: 5, hits: 0 });
		const changed: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'grid') return region;
				const grid = defined(region.grid);
				return { ...region, grid: { ...grid, minimumColumnWidths: [900, 100] as const } };
			}),
		};
		const incremental = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			changed,
			cache,
		);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, changed);
		expect(incremental).toEqual(cold);
		expect(incremental.status).toBe(RegionCompositionStatus.Selected);
		expect(incremental).not.toEqual(original);
		expect(cache.stats).toMatchObject({ misses: 5, hits: 5 });
	});

	it('keeps an indivisible group inside a cell and only invalidates that leaf on resize', () => {
		const { document, input } = nestedGridFixture();
		const grouped: LogicDocument = {
			...document,
			groups: [
				{
					kind: EndpointKind.Group,
					id: 'cell-group',
					label: 'In cell B',
					layoutOrder: orderKey('a6'),
				},
			],
			nodes: document.nodes.map((node) => {
				if (node.id !== 'b') return node;
				return { ...node, groupId: 'cell-group' };
			}),
		};
		const withOwnership: RegionInput = {
			...input,
			regionByEndpointId: new Map([...input.regionByEndpointId, ['cell-group', 'b']]),
		};
		const prepared = prepareLayoutDocument(grouped, {
			groups: {
				'cell-group': {
					minimumWidth: 620,
					minimumHeight: 320,
					headerHeight: 36,
					padding: 24,
				},
			},
		});
		const cache = new RegionLocalLayoutCache();
		const first = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			withOwnership,
			cache,
		);
		if (first.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected grouped grid: ${first.status}: ${first.reason}`);
		const group = defined(first.layout.elements.find(({ id }) => id === 'cell-group'));
		const member = defined(first.layout.elements.find(({ id }) => id === 'b'));
		expect(group.bounds.width).toBeGreaterThanOrEqual(620);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(cache.stats).toMatchObject({ misses: 5, hits: 0 });
		const groups = new Map(prepared.measurements.groups);
		const measured = defined(groups.get('cell-group'));
		groups.set('cell-group', { ...measured, minimumWidth: measured.minimumWidth + 160 });
		const resized = { ...prepared.measurements, groups };
		const incremental = solveRecursiveNestedRegionLayout(
			prepared.graph,
			resized,
			withOwnership,
			cache,
		);
		const cold = solveRecursiveNestedRegionLayout(prepared.graph, resized, withOwnership);
		expect(incremental).toEqual(cold);
		expect(incremental.status).toBe(RegionCompositionStatus.Selected);
		expect(cache.stats).toMatchObject({ misses: 6, hits: 4 });
	});

	it('reserves metric capacity for two inter-cell routes before solving the nested leaves', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument({
			...document,
			relations: [...document.relations, { id: 'second-crossing', from: 'a-target', to: 'c' }],
		});
		const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected nested grid: ${result.status}: ${result.reason}`);
		expect(result.portals).toHaveLength(4);
		expect(result.ownedRoutes.filter(({ regionId }) => regionId === 'grid')).toHaveLength(2);
		const source = defined(result.layout.elements.find(({ id }) => id === 'a-target'));
		expect(source.bounds.height).toBeGreaterThanOrEqual(56);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized nested grid');
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
	});

	it('confines an outer incident under fractional asymmetric sizes and source permutations', () => {
		const fractionalSize = fc.record({
			width: fc.integer({ min: 80, max: 320 }).map((value) => value + 0.25),
			height: fc.integer({ min: 40, max: 160 }).map((value) => value + 0.5),
		});
		fc.assert(
			fc.property(
				fc.record({
					aSource: fractionalSize,
					aTarget: fractionalSize,
					b: fractionalSize,
					outside: fractionalSize,
					minimumColumns: fc.tuple(
						fc.integer({ min: 400, max: 900 }).map((value) => value + 0.25),
						fc.integer({ min: 80, max: 350 }).map((value) => value + 0.5),
					),
					minimumRows: fc.tuple(
						fc.integer({ min: 0, max: 150 }).map((value) => value + 0.5),
						fc.integer({ min: 200, max: 500 }).map((value) => value + 0.25),
					),
					reverse: fc.boolean(),
				}),
				(values) => {
					const { document, input } = nestedGridFixture();
					let relation = { id: 'leaves-grid', from: 'a-target', to: 'outside' };
					if (values.reverse) relation = { id: 'leaves-grid', from: 'outside', to: 'a-target' };
					const source = {
						...document,
						relations: [defined(document.relations.find(({ id }) => id === 'inside-a')), relation],
					};
					const overrides = {
						nodes: {
							'a-source': values.aSource,
							'a-target': values.aTarget,
							b: values.b,
							outside: values.outside,
						},
					};
					const grid = defined(input.regions.find(({ id }) => id === 'grid'));
					const varied: RegionInput = {
						...input,
						regions: input.regions.map((region) => {
							if (region !== grid) return region;
							return {
								...region,
								grid: {
									...defined(region.grid),
									minimumColumnWidths: values.minimumColumns,
									minimumRowHeights: values.minimumRows,
								},
							};
						}),
					};
					const prepared = prepareLayoutDocument(source, overrides);
					const result = solveRecursiveNestedRegionLayout(
						prepared.graph,
						prepared.measurements,
						varied,
					);
					if (result.status !== RegionCompositionStatus.Selected)
						throw new Error(
							`Expected selected fractional grid: ${result.status}: ${result.reason}`,
						);
					const normalized = normalizeRegionCompositionModel(prepared.graph, varied);
					if (normalized.status !== RegionCompositionModelStatus.Ready)
						throw new Error('Expected normalized fractional grid');
					expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
					const permuted = prepareLayoutDocument(
						{
							...source,
							nodes: [...source.nodes].reverse(),
							relations: [...source.relations].reverse(),
						},
						overrides,
					);
					expect(
						solveRecursiveNestedRegionLayout(permuted.graph, permuted.measurements, {
							...varied,
							regions: [...varied.regions].reverse(),
							regionByEndpointId: new Map([...varied.regionByEndpointId].reverse()),
						}),
					).toEqual(result);
				},
			),
			PROPERTY_PARAMETERS,
		);
	});

	it('bridges the strict crossings between three grid routes instead of losing the capacity', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'second-crossing', from: 'a-target', to: 'c' },
				{ id: 'third-crossing', from: 'a-source', to: 'd' },
			],
		});
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const bridges = validatedBridges(attempt.layout.relations);
		expect(bridges.length).toBe(3);
		expect(bridges.every(({ crossedIds }) => crossedIds.length > 0)).toBe(true);
		expect(
			defined(bridges.find(({ carrierIds }) => carrierIds.includes('third-crossing'))),
		).toBeDefined();
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized three-crossing grid');
		expect(
			diagnoseParentRouteContacts(normalized.model, attempt.ownedRoutes, attempt.layout.relations),
		).toBeUndefined();
	});

	it('reports the unbridged parent contact when the relations are omitted', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument({
			...document,
			relations: [...document.relations, { id: 'leaves-grid', from: 'a-target', to: 'outside' }],
		});
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized external-incident grid');
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		expect(diagnoseParentRouteContacts(normalized.model, attempt.ownedRoutes)).toMatchObject({
			code: RegionGeometryDiagnosticCode.ParentRouteContact,
		});
	});

	it('bridges an external incident crossing a grid rail and keeps the scene selected', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument({
			...document,
			relations: [...document.relations, { id: 'leaves-grid', from: 'a-target', to: 'outside' }],
		});
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		expect(normalized.status).toBe(RegionCompositionModelStatus.Ready);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		expect(attempt.status).toBe(RegionCompositionStatus.Selected);
		if (attempt.status !== RegionCompositionStatus.Selected) return;
		const bridges = validatedBridges(attempt.layout.relations);
		expect(bridges).toEqual([
			{ x: 128, y: 188, carrierIds: ['leaves-grid'], crossedIds: ['across-grid'] },
		]);
		if (normalized.status !== RegionCompositionModelStatus.Ready) throw new Error('Expected model');
		expect(
			diagnoseParentRouteContacts(normalized.model, attempt.ownedRoutes, attempt.layout.relations),
		).toBeUndefined();
	});

	it('keeps the external incident deterministic in four directions and both roles', () => {
		const { document, input } = nestedGridFixture();
		const layouts = [
			{ direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
			{ direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
			{ direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
			{ direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right },
		] satisfies readonly LayoutConfiguration[];
		for (const layout of layouts)
			for (const reverse of [false, true]) {
				let from = 'a-target';
				let to = 'outside';
				if (reverse) {
					from = 'outside';
					to = 'a-target';
				}
				const relation = {
					id: 'leaves-grid',
					from,
					to,
				};
				const source: LogicDocument = {
					...document,
					layout,
					relations: [defined(document.relations.find(({ id }) => id === 'inside-a')), relation],
				};
				const prepared = prepareLayoutDocument(source);
				const baseline = solveRecursiveNestedRegionLayout(
					prepared.graph,
					prepared.measurements,
					input,
				);
				if (baseline.status !== RegionCompositionStatus.Selected)
					throw new Error(
						`${layout.direction}: reverse=${reverse}: ${baseline.status}: ${baseline.reason}`,
					);
				const permuted = prepareLayoutDocument({
					...source,
					nodes: [...source.nodes].reverse(),
					relations: [...source.relations].reverse(),
				});
				expect(
					solveRecursiveNestedRegionLayout(permuted.graph, permuted.measurements, {
						regions: [...input.regions].reverse(),
						regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
					}),
				).toEqual(baseline);
				const normalized = normalizeRegionCompositionModel(prepared.graph, input);
				if (normalized.status !== RegionCompositionModelStatus.Ready)
					throw new Error('Expected normalized nested grid');
				expect(validateRegionCompositionGeometry(normalized.model, baseline)).toBeUndefined();
			}
	});

	it('routes an outer incident from the right column without crossing a foreign cell', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument({
			...document,
			relations: [
				defined(document.relations.find(({ id }) => id === 'inside-a')),
				{ id: 'right-exit', from: 'b', to: 'outside' },
			],
		});
		const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected right-column exit: ${result.status}: ${result.reason}`);
		expect(
			result.ownedRoutes
				.filter(({ relationId }) => relationId === 'right-exit')
				.map(({ regionId }) => regionId),
		).toEqual(['b', 'grid', '@root', 'outside']);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized nested grid');
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		const cell = defined(result.regions.find(({ id }) => id === 'b'));
		const portal = defined(
			result.portals.find(
				({ relationId, regionId }) => relationId === 'right-exit' && regionId === 'b',
			),
		);
		expect(
			portal.point.y === cell.bounds.y ||
				portal.point.y === cell.bounds.y + cell.bounds.height ||
				portal.point.x === cell.bounds.x ||
				portal.point.x === cell.bounds.x + cell.bounds.width,
		).toBe(true);
		const cellPiece = defined(
			result.ownedRoutes.find(
				({ relationId, regionId }) => relationId === 'right-exit' && regionId === 'b',
			),
		);
		expect(cellPiece.points.at(-1)).toEqual(portal.point);
		const previous = defined(cellPiece.points.at(-2));
		const terminal = defined(cellPiece.points.at(-1));
		let shortenedEnd = { x: terminal.x, y: (previous.y + terminal.y) / 2 };
		if (previous.y === terminal.y)
			shortenedEnd = { x: (previous.x + terminal.x) / 2, y: terminal.y };
		const shortened = {
			...result,
			ownedRoutes: result.ownedRoutes.map((piece) => {
				if (piece !== cellPiece) return piece;
				return { ...piece, points: [...piece.points.slice(0, -1), shortenedEnd] };
			}),
		};
		expect(validateRegionCompositionGeometry(normalized.model, shortened)).toContain(
			'disconnected boundary portal',
		);
	});

	it('keeps a bridged incident cold-equal across reversal and a resized leaf', () => {
		const { document, input } = nestedGridFixture();
		const source: LogicDocument = {
			...document,
			relations: [...document.relations, { id: 'leaves-grid', from: 'a-target', to: 'outside' }],
		};
		const prepared = prepareLayoutDocument(source);
		const cache = new RegionLocalLayoutCache();
		const first = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		expect(first).toEqual(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input),
		);
		expect(first).toMatchObject({ status: RegionCompositionStatus.Selected });
		expect(cache.stats).toMatchObject({ misses: 5, hits: 0 });
		const reversed = prepareLayoutDocument({
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id !== 'leaves-grid') return relation;
				return { ...relation, from: 'outside', to: 'a-target' };
			}),
		});
		const incremental = solveRecursiveNestedRegionLayout(
			reversed.graph,
			reversed.measurements,
			input,
			cache,
		);
		expect(incremental).toEqual(
			solveRecursiveNestedRegionLayout(reversed.graph, reversed.measurements, input),
		);
		expect(incremental).toMatchObject({ status: RegionCompositionStatus.Selected });
		expect(cache.stats).toMatchObject({ misses: 7, hits: 3 });
		const nodes = new Map(reversed.measurements.nodes);
		const target = defined(nodes.get('a-target'));
		nodes.set('a-target', { ...target, width: target.width + 31 });
		const measurements = { ...reversed.measurements, nodes };
		const resized = solveRecursiveNestedRegionLayout(reversed.graph, measurements, input, cache);
		expect(resized).toEqual(solveRecursiveNestedRegionLayout(reversed.graph, measurements, input));
		expect(resized).toMatchObject({ status: RegionCompositionStatus.Selected });
		expect(cache.stats).toMatchObject({ misses: 8, hits: 7 });
	});

	it('composes two outer incidents on separate top-column rails and reuses unchanged leaves', () => {
		const { document, input } = twoOuterRegionsFixture();
		const source: LogicDocument = {
			...document,
			relations: [
				...document.relations,
				{ id: 'z-left-exit', from: 'a-target', to: 'outside' },
				{ id: 'a-right-exit', from: 'b', to: 'outside-2' },
			],
		};
		const prepared = prepareLayoutDocument(source);
		const cache = new RegionLocalLayoutCache();
		const result = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			input,
			cache,
		);
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected two grid exits: ${result.status}: ${result.reason}`);
		for (const [relationId, cellId, outsideId] of [
			['z-left-exit', 'a', 'outside'],
			['a-right-exit', 'b', 'outside-2'],
		] as const) {
			expect(
				result.portals
					.filter((portal) => portal.relationId === relationId)
					.map(({ regionId }) => regionId),
			).toEqual([cellId, 'grid', outsideId]);
			expect(
				result.ownedRoutes
					.filter((route) => route.relationId === relationId)
					.map(({ regionId }) => regionId),
			).toEqual([cellId, 'grid', '@root', outsideId]);
		}
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized two-incident grid');
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		const permuted = prepareLayoutDocument({
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
		});
		expect(
			solveRecursiveNestedRegionLayout(
				permuted.graph,
				permuted.measurements,
				{
					regions: [...input.regions].reverse(),
					regionByEndpointId: new Map([...input.regionByEndpointId].reverse()),
				},
				cache,
			),
		).toEqual(result);
		expect(cache.stats.hits).toBeGreaterThan(0);
	});

	it('keeps reverse grid contacts distinct and resolves a nested parent-bus order', () => {
		const { document, input } = twoOuterRegionsFixture();
		const reversed = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'z-left-exit', from: 'outside', to: 'a-target' },
				{ id: 'a-right-exit', from: 'outside-2', to: 'b' },
			],
		});
		const result = solveRecursiveNestedRegionLayout(reversed.graph, reversed.measurements, input);
		if (result.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected reverse grid contacts: ${result.status}: ${result.reason}`);
		const normalized = normalizeRegionCompositionModel(reversed.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized reverse grid contacts');
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
		const crossed = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'a-left-exit', from: 'a-target', to: 'outside' },
				{ id: 'z-right-exit', from: 'b', to: 'outside-2' },
			],
		});
		const reordered = solveRecursiveNestedRegionLayout(crossed.graph, crossed.measurements, input);
		if (reordered.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected nested parent rails: ${reordered.status}: ${reordered.reason}`);
		const reorderedModel = normalizeRegionCompositionModel(crossed.graph, input);
		if (reorderedModel.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized nested parent rails');
		expect(validateRegionCompositionGeometry(reorderedModel.model, reordered)).toBeUndefined();
	});

	it('decides multiple grid exits by routed geometry', () => {
		const { document, input } = twoOuterRegionsFixture();
		function decided(
			prepared: ReturnType<typeof prepareLayoutDocument>,
			expected: RegionCompositionStatus.Selected | RegionCompositionStatus.Unknown,
			bridges?: number,
		): void {
			const attempt = solveRecursiveNestedRegionLayout(
				prepared.graph,
				prepared.measurements,
				input,
			);
			expect(attempt.status).toBe(expected);
			if (attempt.status === RegionCompositionStatus.Unknown) {
				expect(attempt.code).toBe(RegionGeometryDiagnosticCode.ParentRouteContact);
				return;
			}
			if (attempt.status !== RegionCompositionStatus.Selected) return;
			if (bridges !== undefined)
				expect(validatedBridges(attempt.layout.relations)).toHaveLength(bridges);
			const normalized = normalizeRegionCompositionModel(prepared.graph, input);
			if (normalized.status !== RegionCompositionModelStatus.Ready)
				throw new Error('Expected normalized grid composition');
			expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		}
		const sameCell = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'first', from: 'a-source', to: 'outside' },
				{ id: 'second', from: 'a-target', to: 'outside-2' },
			],
		});
		decided(sameCell, RegionCompositionStatus.Unknown);
		const sameColumn = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'left-exit', from: 'a-target', to: 'outside' },
				{ id: 'another-left-exit', from: 'c', to: 'outside-2' },
			],
		});
		decided(sameColumn, RegionCompositionStatus.Unknown);
		const crossing = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'across-grid', from: 'a-target', to: 'd' },
				{ id: 'left-exit', from: 'a-target', to: 'outside' },
				{ id: 'right-exit', from: 'b', to: 'outside-2' },
			],
		});
		decided(crossing, RegionCompositionStatus.Selected, 2);
		const bottom = prepareLayoutDocument({
			...document,
			layout: { direction: LayoutDirection.BottomToTop, bias: LayoutBias.Bottom },
			relations: [
				...document.relations,
				{ id: 'first', from: 'a-target', to: 'outside' },
				{ id: 'second', from: 'b', to: 'outside-2' },
			],
		});
		decided(bottom, RegionCompositionStatus.Selected);
		const third = prepareLayoutDocument({
			...document,
			relations: [
				...document.relations,
				{ id: 'first', from: 'a-target', to: 'outside' },
				{ id: 'second', from: 'b', to: 'outside-2' },
				{ id: 'third', from: 'c', to: 'outside' },
			],
		});
		decided(third, RegionCompositionStatus.Unknown);
	});

	it('returns a typed geometry failure when a nested grid cell route crosses an element', () => {
		const { document, input } = nestedGridFixture();
		const nested: RegionInput = {
			...input,
			regions: [
				...input.regions,
				{ id: 'a-source-leaf', parentId: 'a', layoutOrder: 'a' },
				{ id: 'a-target-leaf', parentId: 'a', layoutOrder: 'b' },
			],
			regionByEndpointId: new Map(
				[...input.regionByEndpointId].map(([endpointId, regionId]) => {
					if (endpointId === 'a-source') return [endpointId, 'a-source-leaf'];
					if (endpointId === 'a-target') return [endpointId, 'a-target-leaf'];
					return [endpointId, regionId];
				}),
			),
		};
		const prepared = prepareLayoutDocument(document);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, nested);
		if (
			attempt.status !== RegionCompositionStatus.Unknown ||
			attempt.provenance !== RegionSearchProvenance.Grid
		)
			throw new Error('Expected recursive grid search evidence.');
		expect(attempt.code).toBe(RegionGeometryDiagnosticCode.GridCrossingEntersElement);
		expect(attempt.reason).toBe('Cross-cell relation across-grid enters element a-source.');
		expect(attempt.regionId).toBe('grid');
		expect(attempt.witness.attempted).toBeGreaterThan(0);
		expect(attempt.witness.phases).toMatchObject([
			{ attempted: true, exhaustive: true },
			{ attempted: true, exhaustive: true },
			{ attempted: true, exhaustive: true },
		]);
		const subtree = solveRegionSubtreeAttempts({
			graph: prepared.graph,
			measurements: prepared.measurements,
			input: nested,
			cache: new RegionLocalLayoutCache(),
		}).find(
			({ regionId, scope }) => regionId === 'grid' && scope === RegionSubtreeScope.ClosedSubtree,
		);
		if (
			subtree?.status !== RegionCompositionStatus.Unknown ||
			subtree.provenance !== RegionSearchProvenance.Grid
		)
			throw new Error('Expected grid subtree search evidence.');
		expect(subtree.code).toBe(RegionGeometryDiagnosticCode.GridCrossingEntersElement);
		expect(subtree.witness.attempted).toBeGreaterThan(0);
		expect(subtree.witness.phases).toMatchObject([
			{ attempted: true, exhaustive: true },
			{ attempted: true, exhaustive: true },
			{ attempted: true, exhaustive: true },
		]);
	});

	it('translates and confines two shared lanes in one grid cell beside ordinary leaves', () => {
		const { input } = nestedGridFixture();
		const document = persistedNestedGridDocument();
		const template = defined(document.nodes.find(({ id }) => id === 'b'));
		const lanePresentation = {
			laneOrientation: LaneOrientation.Parallel,
			growth: LaneGrowth.Auto,
			lanes: [
				{ id: 'sales', label: 'Sales', layoutOrder: orderKey('a0') },
				{ id: 'service', label: 'Service', layoutOrder: orderKey('a1') },
			],
		};
		const withLanes: LogicDocument = {
			...document,
			regionPresentation: {
				...document.regionPresentation,
				regions: document.regionPresentation.regions.map((region) => {
					if (region.id !== 'b') return region;
					return { ...region, lanePresentation };
				}),
			},
			nodes: [
				...document.nodes.map((node) => {
					if (node.id !== 'b') return node;
					return { ...node, laneId: 'sales' };
				}),
				{ ...template, id: 'b2', laneId: 'service', layoutOrder: orderKey('a6') },
			],
		};
		const nested: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'b') return region;
				return { ...region, policy: LayoutPolicy.SharedLanes, lanePresentation };
			}),
			regionByEndpointId: new Map([...input.regionByEndpointId, ['b2', 'b']]),
		};
		const prepared = prepareLayoutDocument(withLanes);
		const selected = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nested,
		);
		if (selected.status !== RegionCompositionStatus.Selected)
			throw new Error(`Expected selected grid with local lanes: ${selected.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, nested);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized grid with local lanes');
		expect(validateRegionCompositionGeometry(normalized.model, selected)).toBeUndefined();
		const cell = defined(selected.regions.find(({ id }) => id === 'b'));
		const localLanes = defined(cell.localLayout.lanes);
		const globalLanes = defined(selected.layout.lanes).filter(({ regionId }) => regionId === 'b');
		expect(localLanes.map(({ id }) => id)).toEqual(['sales', 'service']);
		expect(globalLanes.map(({ id }) => id)).toEqual(['sales', 'service']);
		for (const local of localLanes) {
			const global = defined(globalLanes.find(({ id }) => id === local.id));
			expect(global.bounds).toEqual({
				...local.bounds,
				x: local.bounds.x + defined(cell.translation).x,
				y: local.bounds.y + defined(cell.translation).y,
			});
			expect(within(cell.bounds, global.bounds)).toBe(true);
		}
		for (const [nodeId, laneId] of [
			['b', 'sales'],
			['b2', 'service'],
		] as const) {
			const element = defined(selected.layout.elements.find(({ id }) => id === nodeId));
			const lane = defined(globalLanes.find(({ id }) => id === laneId));
			expect(within(lane.bounds, element.bounds)).toBe(true);
		}
		expect(selected.portals.filter(({ relationId }) => relationId === 'across-grid')).toHaveLength(
			2,
		);
	});

	it('rejects a junction inside a grid before any cell layout is composed', () => {
		const { document, input } = nestedGridFixture();
		const withJunction: LogicDocument = {
			...document,
			junctions: [
				{
					kind: EndpointKind.Junction,
					id: 'junction-in-b',
					operator: JunctionOperator.Xor,
					layoutOrder: orderKey('a6'),
				},
			],
		};
		const nested: RegionInput = {
			...input,
			regionByEndpointId: new Map([...input.regionByEndpointId, ['junction-in-b', 'b']]),
		};
		const prepared = prepareLayoutDocument(withJunction);
		expect(solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, nested)).toEqual(
			{
				status: RegionCompositionStatus.Unsupported,
				reason: 'Junctions are outside this bounded grid proof.',
			},
		);
	});

	it('reports an unresolved crossing when a local sibling blocks its cell exit', () => {
		const { document, input } = nestedGridFixture();
		const blocked: LogicDocument = {
			...document,
			relations: [
				{ id: 'inside-a', from: 'a-target', to: 'a-source' },
				{ id: 'across-grid', from: 'a-target', to: 'd' },
			],
		};
		const nested: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'a') return region;
				return {
					...region,
					layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
				};
			}),
		};
		const prepared = prepareLayoutDocument(blocked);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, nested);
		expect(attempt.status).toBe(RegionCompositionStatus.Unknown);
		if (attempt.status === RegionCompositionStatus.Unknown)
			expect(attempt.reason).toContain('enters element a-source');
	});

	it('reports a cell outside the grid subtree and invalid track minima', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument(document);
		const replaceGrid = (
			change: (
				grid: NonNullable<RegionInput['regions'][number]['grid']>,
			) => NonNullable<RegionInput['regions'][number]['grid']>,
		): RegionInput => ({
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'grid') return region;
				return { ...region, grid: change(defined(region.grid)) };
			}),
		});
		const foreignCell = replaceGrid((grid) => ({
			...grid,
			cells: grid.cells.map((cell) => {
				if (cell.regionId !== 'd') return cell;
				return { ...cell, regionId: 'outside' };
			}),
		}));
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, foreignCell),
		).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'Region grid has an invalid grid cell set.',
		});
		const invalidMinimum = replaceGrid((grid) => ({
			...grid,
			minimumColumnWidths: [-1, 100],
		}));
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, invalidMinimum),
		).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'Track minima must be finite nonnegative dimensions.',
		});
	});

	it('requires cells that cover one rectangle even when the region tree itself is valid', () => {
		const { document, input } = nestedGridFixture();
		const fewerCells: RegionInput = {
			regions: input.regions
				.filter(({ id }) => id !== 'd')
				.map((region) => {
					if (region.id !== 'grid') return region;
					const grid = defined(region.grid);
					return {
						...region,
						grid: { ...grid, cells: grid.cells.filter(({ regionId }) => regionId !== 'd') },
					};
				}),
			regionByEndpointId: new Map(
				[...input.regionByEndpointId].map(([endpointId, regionId]) => {
					if (regionId === 'd') return [endpointId, 'c'];
					return [endpointId, regionId];
				}),
			),
		};
		const prepared = prepareLayoutDocument(document);
		expect(
			solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, fewerCells),
		).toEqual({
			status: RegionCompositionStatus.Unsupported,
			reason: 'Cells must uniquely cover the root grid rectangle.',
		});
	});

	it('lets one cell choose a local flow direction without changing the grid tracks', () => {
		const { document, input } = nestedGridFixture();
		const prepared = prepareLayoutDocument(document);
		const changed: RegionInput = {
			...input,
			regions: input.regions.map((region) => {
				if (region.id !== 'a') return region;
				return {
					...region,
					layout: { direction: LayoutDirection.LeftToRight, bias: LayoutBias.Left },
				};
			}),
		};
		const result = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, changed);
		expect(result.status).toBe(RegionCompositionStatus.Selected);
		if (result.status !== RegionCompositionStatus.Selected) return;
		const normalized = normalizeRegionCompositionModel(prepared.graph, changed);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected normalized nested grid');
		expect(validateRegionCompositionGeometry(normalized.model, result)).toBeUndefined();
	});
});
