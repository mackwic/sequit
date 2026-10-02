import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	GRID_REGION_PRESENTATION_SCHEMA,
	LayoutBias,
	type LayoutConfiguration,
	layoutConfiguration,
	LayoutDirection,
	type LogicDocument,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	crossingIncidence,
	gridRoutingEdges,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import { canonicalCrossingAllocation } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import type { CrossingAllocationInput } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation-types';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import {
	crossingRoutes,
	gridCrossingRouting,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-routing';
import {
	entersInterior,
	within,
} from '../../../../src/lib/core/layout/grids/grid-cell-geometry-primitives';
import {
	routePlacedGridCellDisposition,
	solveGridCellLayout,
} from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { normalize } from '../../../../src/lib/core/layout/grids/grid-cell-model';
import { normalizeGridCellRegionModel } from '../../../../src/lib/core/layout/grids/grid-cell-region-model';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import { RegionCompositionModelStatus } from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { RegionPortalSide } from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { layoutDocument, overlaps, prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	gridOf,
	gridWithLocalRelations,
} from '../../../support/performance/layout-resource-scenarios';
import {
	gridDocument,
	gridInput,
	nxmThreeByTwoDocument,
	nxmThreeByTwoInput,
	persistedCellGrid,
	persistedGridDocument,
	prepareGrid,
} from './grid-cell-fixture';

/** Left to right puts a-top between a-bottom and the left portal of cell a. */
function hiddenEndpointInput(): GridCellInput {
	const input = gridInput();
	const hiddenFlow: LayoutConfiguration = {
		direction: LayoutDirection.LeftToRight,
		bias: LayoutBias.Left,
	};
	const cells = input.cells.map((cell) => {
		if (cell.id !== 'a') return cell;
		return { ...cell, layout: hiddenFlow };
	});
	return { ...input, cells };
}

describe('bounded two by two grid composition', () => {
	it.each(Object.values(LayoutDirection))(
		'renders a two by two grid with an opaque empty cell in %s',
		async (direction) => {
			const base = persistedGridDocument();
			const document = {
				...base,
				layout: defined(
					layoutConfiguration(direction, LayoutBias.Top) ??
						layoutConfiguration(direction, LayoutBias.Left),
				),
				nodes: base.nodes.filter(({ id }) => id !== 'c' && id !== 'a-top'),
				relations: base.relations.filter(({ id }) => id !== 'inside-a'),
			};
			const input = {
				...gridInput(),
				minimumColumnWidths: [700, 1000],
				minimumRowHeights: [700, 800],
				cellByEndpointId: new Map(
					[...gridInput().cellByEndpointId].filter(([id]) => id !== 'c' && id !== 'a-top'),
				),
			};
			const presentation = defined(document.regionPresentation);
			if (presentation.schemaVersion !== GRID_REGION_PRESENTATION_SCHEMA)
				throw new Error('Expected root grid presentation');
			const grid = defined(presentation.grid);
			const persisted = {
				...document,
				regionPresentation: {
					...presentation,
					grid: {
						...grid,
						minimumColumnWidths: input.minimumColumnWidths,
						minimumRowHeights: input.minimumRowHeights,
					},
				},
			};
			const prepared = prepareLayoutDocument(document);
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
			if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
			const empty = result.cells.find(({ id }) => id === 'c');
			if (empty === undefined) throw new Error('Expected empty cell');
			expect(empty.bounds).toMatchObject({ width: 700, height: 800 });
			expect(empty.localLayout).toEqual({ width: 0, height: 0, elements: [], relations: [] });
			expect(result.portals.some(({ cellId }) => cellId === 'c')).toBe(false);
			for (const [index, cell] of result.cells.entries())
				for (const other of result.cells.slice(index + 1))
					expect(overlaps(cell.bounds, other.bounds)).toBe(false);
			for (const route of result.layout.relations)
				for (let index = 1; index < route.points.length; index += 1)
					expect(
						entersInterior(
							defined(route.points[index - 1]),
							defined(route.points[index]),
							empty.bounds,
						),
					).toBe(false);
			expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
			const rendered = await layoutDocument(persisted);
			expect(rendered.layout.regions?.find(({ id }) => id === 'c')?.bounds).toEqual(empty.bounds);
		},
	);
	it('selects a complete grid with 21 independent endpoints, beyond the old shape limit', () => {
		const { document, input } = gridOf(3, 7);
		const prepared = prepareLayoutDocument(document);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.layout.elements).toHaveLength(21);
		expect(result.cells).toHaveLength(21);
		expect(result.witness.attempted).toBe(1);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('selects 21 local relations without confusing relation count with crossing work', () => {
		const { document, input } = gridWithLocalRelations();
		const prepared = prepareLayoutDocument(document);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.layout.relations).toHaveLength(21);
		expect(result.witness.attempted).toBe(1);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});
	it('reports an unsolved local cycle without publishing a partial grid', () => {
		const prepared = prepareGrid();
		const endpoint = prepared.graph.endpointsById.get('a-top');
		if (endpoint === undefined) throw new Error('Expected the a-top endpoint.');
		const graph = {
			...prepared.graph,
			relations: [
				...prepared.graph.relations,
				{
					relation: { id: 'local-cycle', from: 'a-top', to: 'a-top' },
					source: endpoint,
					target: endpoint,
				},
			],
		};
		expect(solveGridCellLayout(graph, prepared.measurements, gridInput())).toEqual({
			status: GridCellLayoutStatus.Unknown,
			reason: 'A child graph could not be solved independently.',
		});
	});

	it('propagates a duplicate relation identity rejected by the common ownership model', () => {
		const prepared = prepareGrid();
		const first = prepared.graph.relations[0];
		if (first === undefined) throw new Error('Expected a relation in the grid fixture.');
		const duplicateGraph = {
			...prepared.graph,
			relations: [...prepared.graph.relations, first],
		};
		expect(solveGridCellLayout(duplicateGraph, prepared.measurements, gridInput())).toEqual({
			status: GridCellLayoutStatus.Unsupported,
			reason: `Duplicate relation identity ${first.relation.id}.`,
		});
	});

	it('can compose the same grid in the local coordinates of a named region', () => {
		const prepared = prepareGrid();
		const rootInput = gridInput();
		const regionId = 'inner-grid';
		const innerInput: GridCellInput = {
			...rootInput,
			rootId: regionId,
			cells: rootInput.cells.map((cell) => ({ ...cell, parentId: regionId })),
		};
		const root = solveGridCellLayout(prepared.graph, prepared.measurements, rootInput);
		const inner = solveGridCellLayout(prepared.graph, prepared.measurements, innerInput);
		expect(root.status).toBe(GridCellLayoutStatus.Selected);
		expect(inner.status).toBe(GridCellLayoutStatus.Selected);
		if (root.status !== GridCellLayoutStatus.Selected) return;
		if (inner.status !== GridCellLayoutStatus.Selected) return;
		expect(inner.rootId).toBe(regionId);
		expect(inner.cells.every(({ parentId }) => parentId === regionId)).toBe(true);
		expect(inner.layout).toEqual(root.layout);
		expect(validateGridCellGeometry(inner, prepared.graph, innerInput)).toBeUndefined();
	});

	it('solves independent child ranks, extends only required tracks, and routes outside opaque cells', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.cells.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd']);
		expect(result.cells[0]?.localRanks.byEndpointId.get('a-bottom')).toBe(1);
		expect(result.cells[0]?.localRanks.byEndpointId.get('a-top')).toBe(0);
		expect(result.cells[3]?.localRanks.byEndpointId.get('d')).toBe(0);
		expect(result.columnWidths[0]).toBe(700);
		expect(result.columnWidths[1]).toBeGreaterThan(620);
		expect(result.rowHeights[0]).toBeGreaterThan(320);
		expect(result.rowHeights[1]).toBe(300);
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const member = result.layout.elements.find(({ id }) => id === 'b');
		expect(group).toBeDefined();
		expect(member).toBeDefined();
		if (group === undefined || member === undefined) return;
		expect(group.bounds.width).toBeGreaterThanOrEqual(620);
		expect(member.bounds.x).toBeGreaterThan(group.bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(group.bounds.x + group.bounds.width);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('is invariant to permutation of document, cells, and ownership entries', () => {
		const original = gridDocument();
		const input = gridInput();
		const baseline = prepareGrid(original);
		const permuted = prepareGrid({
			...original,
			nodes: [...original.nodes].reverse(),
			groups: [...original.groups].reverse(),
			relations: [...original.relations].reverse(),
		});
		const permutedInput: GridCellInput = {
			...input,
			cells: [...input.cells].reverse(),
			cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
		};
		expect(solveGridCellLayout(permuted.graph, permuted.measurements, permutedInput)).toEqual(
			solveGridCellLayout(baseline.graph, baseline.measurements, input),
		);
	});

	it('uses one exterior rail when both endpoint cells share a column', () => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: document.relations.map((relation) => {
				if (relation.id !== 'across-grid') return relation;
				return { ...relation, to: 'c' };
			}),
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('does not require or route through a bus when both endpoints share a rail', () => {
		const source = gridDocument();
		const document = {
			...source,
			relations: [
				{ id: 'inside-a', from: 'a-bottom', to: 'a-top' },
				{ id: 'a-c', from: 'a-bottom', to: 'c' },
				{ id: 'top-c', from: 'a-top', to: 'c' },
			],
		};
		const prepared = prepareGrid(document);
		const input = gridInput();
		const selected = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== GridCellLayoutStatus.Selected)
			throw new Error('Expected same-rail crossing routes to be selected.');
		const crossing = prepared.graph.relations
			.map(({ relation }) => relation)
			.filter(
				({ from, to }) => input.cellByEndpointId.get(from) !== input.cellByEndpointId.get(to),
			);
		const edges = gridRoutingEdges(
			input.rootId,
			[crossing.map(({ id }) => id), []],
			crossing.length,
		);
		const incidence = crossingIncidence(crossing);
		const allocationInput: CrossingAllocationInput = {
			edges,
			crossingIds: crossing.map(({ id }) => id),
			busRelevantRelationIds: [],
			gutterIds: [crossing.map(({ id }) => id), []],
			incidence,
			portalByRelationId: new Map(),
		};
		const routing = gridCrossingRouting({
			rootId: input.rootId,
			crossing,
			columnCount: 2,
			cells: selected.cells,
			cellByEndpointId: input.cellByEndpointId,
			edges,
			incidence,
			nestedEndpointIds: new Set<string>(),
		});
		const canonical = canonicalCrossingAllocation(allocationInput);
		const busless = { ...canonical, busTrackByRelationId: new Map<string, number>() };
		expect(crossingRoutes(routing, busless)).toEqual(crossingRoutes(routing, canonical));
	});

	it('allocates distinct ports and exterior tracks to multiple crossing relations', () => {
		const document = gridDocument();
		const withCrossings: LogicDocument = {
			...document,
			relations: [
				...document.relations,
				{ id: 'second-crossing', from: 'a-bottom', to: 'c' },
				{ id: 'third-crossing', from: 'a-top', to: 'd' },
			],
		};
		const input = gridInput();
		const prepared = prepareGrid(withCrossings);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		const routes = new Map(result.layout.relations.map((route) => [route.id, route]));
		expect(routes.get('across-grid')?.points[0]).not.toEqual(
			routes.get('second-crossing')?.points[0],
		);
		expect(routes.get('across-grid')?.points.at(-1)).not.toEqual(
			routes.get('third-crossing')?.points.at(-1),
		);
		expect(new Set(result.portals.map(({ relationId }) => relationId)).size).toBe(3);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();

		const reversed = prepareGrid({
			...withCrossings,
			relations: [...withCrossings.relations].reverse(),
		});
		expect(solveGridCellLayout(reversed.graph, reversed.measurements, input)).toEqual(result);
	});

	it('connects local rank four to local rank one without imposing a shared inter-cell rank', () => {
		const base = gridDocument();
		const document: LogicDocument = {
			...base,
			nodes: [
				...base.nodes.filter(({ id }) => id !== 'd'),
				{
					kind: EndpointKind.Node,
					id: 'a-two',
					natureId: 'task',
					markdown: 'A two\n',
					layoutOrder: orderKey('a5'),
				},
				{
					kind: EndpointKind.Node,
					id: 'a-three',
					natureId: 'task',
					markdown: 'A three\n',
					layoutOrder: orderKey('a6'),
				},
				{
					kind: EndpointKind.Node,
					id: 'source-rank-four',
					natureId: 'task',
					markdown: 'Source\n',
					layoutOrder: orderKey('a7'),
				},
				{
					kind: EndpointKind.Node,
					id: 'target-rank-one',
					natureId: 'task',
					markdown: 'Target\n',
					layoutOrder: orderKey('a8'),
				},
				{
					kind: EndpointKind.Node,
					id: 'd-sink',
					natureId: 'task',
					markdown: 'D sink\n',
					layoutOrder: orderKey('a9'),
				},
			],
			relations: [
				{ id: 'inside-a', from: 'a-bottom', to: 'a-top' },
				{ id: 'a-two-to-one', from: 'a-two', to: 'a-bottom' },
				{ id: 'a-three-to-two', from: 'a-three', to: 'a-two' },
				{ id: 'a-four-to-three', from: 'source-rank-four', to: 'a-three' },
				{ id: 'd-one-to-zero', from: 'target-rank-one', to: 'd-sink' },
				{ id: 'across-grid', from: 'source-rank-four', to: 'target-rank-one' },
			],
		};
		const input = gridInput();
		const ownership = new Map(input.cellByEndpointId);
		ownership.delete('d');
		for (const id of ['a-two', 'a-three', 'source-rank-four']) ownership.set(id, 'a');
		for (const id of ['target-rank-one', 'd-sink']) ownership.set(id, 'd');
		const prepared = prepareGrid(document);
		const configured = { ...input, cellByEndpointId: ownership };
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, configured);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		expect(result.cells[0]?.localRanks.byEndpointId.get('source-rank-four')).toBe(4);
		expect(result.cells[3]?.localRanks.byEndpointId.get('target-rank-one')).toBe(1);
		expect(
			result.layout.relations.find(({ id }) => id === 'across-grid')?.points.length,
		).toBeGreaterThan(2);
		expect(validateGridCellGeometry(result, prepared.graph, configured)).toBeUndefined();
	});

	it.each(['b', 'c'])(
		'independently rejects a route that enters opaque foreign cell %s, even when empty',
		(id) => {
			const base = gridDocument();
			const prepared = prepareGrid({
				...base,
				nodes: base.nodes.filter((node) => id !== 'c' || node.id !== 'c'),
			});
			const originalInput = gridInput();
			const input = {
				...originalInput,
				cellByEndpointId: new Map(
					[...originalInput.cellByEndpointId].filter(
						([endpoint]) => id !== 'c' || endpoint !== 'c',
					),
				),
			};
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
			if (result.status !== GridCellLayoutStatus.Selected)
				throw new Error('Expected selected fixture');
			const route = result.layout.relations.find(({ id }) => id === 'across-grid');
			const foreign = result.cells.find((cell) => cell.id === id);
			if (route === undefined || foreign === undefined)
				throw new Error('Expected route and foreign cell');
			const rail = route.points[route.points.length - 3];
			if (rail === undefined) throw new Error('Expected right rail');
			const y = foreign.bounds.y + foreign.bounds.height / 2;
			const x = foreign.bounds.x + foreign.bounds.width / 2;
			const points = [
				...route.points.slice(0, -3),
				{ x: rail.x, y },
				{ x, y },
				{ x: rail.x, y },
				...route.points.slice(-3),
			];
			const damaged = {
				...result,
				layout: {
					...result.layout,
					relations: result.layout.relations.map((item) => {
						if (item.id === route.id) return { ...item, points };
						return item;
					}),
				},
			};
			expect(validateGridCellGeometry(damaged, prepared.graph, input)).toContain(
				`opaque cell ${id}`,
			);
		},
	);

	// The group sits in cell b. a-bottom's cell a lies on its left, so the incoming crossing ports on
	// the group face looking at it. d lies below, but the row gap there carries across-grid: going
	// straight down would cross it without a bridge, so the outgoing one keeps its gutter face.
	it.each([
		{
			id: 'group-outgoing',
			from: 'oversized',
			to: 'd',
			source: true,
			side: RegionPortalSide.Right,
		},
		{
			id: 'group-incoming',
			from: 'a-bottom',
			to: 'oversized',
			source: false,
			side: RegionPortalSide.Left,
		},
	])('attaches a direct cross-cell $id to the outside face of its indivisible group', (edge) => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: [...document.relations, { id: edge.id, from: edge.from, to: edge.to }],
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		expect(result.status).toBe(GridCellLayoutStatus.Selected);
		if (result.status !== GridCellLayoutStatus.Selected) return;
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const member = result.layout.elements.find(({ id }) => id === 'b');
		const route = result.layout.relations.find(({ id }) => id === edge.id);
		const groupCell = result.cells.find(({ id }) => id === 'b');
		if (
			group === undefined ||
			member === undefined ||
			route === undefined ||
			groupCell === undefined
		)
			throw new Error('Expected group, member, route and cell');
		let port = defined(route.points[0]);
		if (!edge.source) port = defined(route.points.at(-1));
		const { bounds } = group;
		const cell = groupCell.bounds;
		expect(port.y).toBeGreaterThan(bounds.y);
		expect(port.y).toBeLessThan(bounds.y + bounds.height);
		let portal = { x: cell.x + cell.width, y: port.y };
		if (edge.side === RegionPortalSide.Right) expect(port.x).toBe(bounds.x + bounds.width);
		else {
			expect(port.x).toBe(bounds.x);
			portal = { x: cell.x, y: port.y };
		}
		expect(result.portals.filter(({ relationId }) => relationId === edge.id)).toHaveLength(2);
		expect(
			result.portals.find(
				({ relationId, endpointId }) => relationId === edge.id && endpointId === 'oversized',
			),
		).toMatchObject({ cellId: 'b', regionId: 'b', side: edge.side, point: portal });
		expect(member.bounds.x).toBeGreaterThan(bounds.x);
		expect(member.bounds.x + member.bounds.width).toBeLessThan(bounds.x + bounds.width);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});

	it('rejects a selected group candidate whose member leaves the group but stays in its cell', () => {
		const document = gridDocument();
		const prepared = prepareGrid({
			...document,
			relations: [...document.relations, { id: 'group-cross', from: 'oversized', to: 'd' }],
		});
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected selected group candidate: ${result.status}: ${result.reason}`);
		const group = result.layout.elements.find(({ id }) => id === 'oversized');
		const cell = result.cells.find(({ id }) => id === 'b');
		if (group === undefined || cell === undefined) throw new Error('Expected group and cell');
		const changedLocal = {
			x: group.bounds.x + group.bounds.width - cell.translation.x + 4,
			y: group.bounds.y - cell.translation.y + 4,
			width: 8,
			height: 8,
		};
		const changedGlobal = {
			...changedLocal,
			x: changedLocal.x + cell.translation.x,
			y: changedLocal.y + cell.translation.y,
		};
		const damaged = {
			...result,
			cells: result.cells.map((current) => {
				if (current.id !== 'b') return current;
				return {
					...current,
					localLayout: {
						...current.localLayout,
						elements: current.localLayout.elements.map((element) => {
							if (element.id !== 'b') return element;
							return { ...element, bounds: changedLocal };
						}),
					},
				};
			}),
			layout: {
				...result.layout,
				elements: result.layout.elements.map((element) => {
					if (element.id !== 'b') return element;
					return { ...element, bounds: changedGlobal };
				}),
			},
		};
		expect(validateGridCellGeometry(damaged, prepared.graph, input)).toBe(
			'Endpoint b leaves its parent group oversized.',
		);
	});

	it('reports unsupported grid structure explicitly', () => {
		const prepared = prepareGrid();
		const input = gridInput();
		const missing = { ...input, cells: input.cells.slice(0, 3) };
		expect(solveGridCellLayout(prepared.graph, prepared.measurements, missing).status).toBe(
			GridCellLayoutStatus.Unsupported,
		);
	});

	it.each([
		{ phase: 'reallocate', budgets: { rowGutter: 1, reallocate: 0, extraTrack: 1, bridge: 1 } },
		{ phase: 'extraTrack', budgets: { rowGutter: 1, reallocate: 1, extraTrack: 0, bridge: 1 } },
		{ phase: 'bridge', budgets: { rowGutter: 1, reallocate: 1, extraTrack: 1, bridge: 0 } },
		{ phase: 'extraTrack', budgets: { rowGutter: 1, reallocate: 1, extraTrack: 1.5, bridge: 1 } },
	])('rejects a non-positive or fractional $phase budget at the public entry', ({ budgets }) => {
		const prepared = prepareGrid();
		expect(() =>
			solveGridCellLayout(prepared.graph, prepared.measurements, gridInput(), {
				allocationBudgets: budgets,
			}),
		).toThrow('Grid crossing allocation budgets must be positive safe integers.');
	});

	it.each([255, 256, 257])(
		'charges only examined row-gutter geometries at a %i-unit boundary',
		(rowGutter) => {
			const document = nxmThreeByTwoDocument();
			const graph = prepareLayoutDocument({
				...document,
				relations: [...document.relations, { id: 'd-to-f', from: 'd', to: 'f' }],
			});
			const input = nxmThreeByTwoInput();
			const result = solveGridCellLayout(graph.graph, graph.measurements, input, {
				allocationBudgets: { rowGutter, reallocate: 256, extraTrack: 256, bridge: 256 },
			});
			expect(result.status).toBe(GridCellLayoutStatus.Selected);
			if (result.status !== GridCellLayoutStatus.Selected) return;
			const row = result.witness.phases[0];
			if (row === undefined) throw new Error('Expected the row-gutter phase');
			expect(row.exploredGeometries).toBe(rowGutter);
			expect(row.truncated).toBe(true);
			expect(row.exhaustive).toBe(false);
			expect(BigInt(row.totalGeometries)).toBeGreaterThan(BigInt(rowGutter));
			expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Reallocate);
			expect(validateGridCellGeometry(result, graph.graph, input)).toBeUndefined();
		},
	);

	it('reaches an endpoint its sibling hides from the portal through a corridor of its own cell', () => {
		const prepared = prepareGrid();
		const configured = hiddenEndpointInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, configured);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`Expected the hidden endpoint to be reached: ${result.reason}`);
		expect(validateGridCellGeometry(result, prepared.graph, configured)).toBeUndefined();
		const elements = new Map(result.layout.elements.map((element) => [element.id, element]));
		const top = defined(elements.get('a-top')).bounds;
		const bottom = defined(elements.get('a-bottom')).bounds;
		expect(top.x + top.width).toBeLessThan(bottom.x);
		const portal = defined(
			result.portals.find(({ relationId, endpointId }) => {
				return relationId === 'across-grid' && endpointId === 'a-bottom';
			}),
		);
		const route = defined(result.layout.relations.find(({ id }) => id === 'across-grid'));
		const end = route.points.findIndex(({ x, y }) => x === portal.point.x && y === portal.point.y);
		const piece = route.points.slice(0, end + 1);
		const cell = defined(result.cells.find(({ id }) => id === 'a')).bounds;
		expect(piece.length).toBeGreaterThan(2);
		for (const point of piece) expect(within(cell, { ...point, width: 0, height: 0 })).toBe(true);
		for (const [index, point] of piece.slice(1).entries())
			expect(entersInterior(defined(piece[index]), point, top)).toBe(false);

		// The former straight attachment, from the same port to the portal and its rail.
		const port = defined(piece[0]);
		const direct = { x: portal.point.x, y: port.y };
		const rail = { x: defined(route.points[end + 1]).x, y: port.y };
		const forged = {
			...result,
			layout: {
				...result.layout,
				relations: result.layout.relations.map((relation) => {
					if (relation.id !== 'across-grid') return relation;
					return { ...relation, points: [port, direct, rail, ...route.points.slice(end + 2)] };
				}),
			},
			portals: result.portals.map((candidate) => {
				if (candidate !== portal) return candidate;
				return { ...portal, point: direct, localPoint: { x: 0, y: direct.y - cell.y } };
			}),
		};
		expect(validateGridCellGeometry(forged, prepared.graph, configured)).toBe(
			'Cross-cell relation across-grid enters element a-top.',
		);
	});

	it('returns a real truncated grid failure with its diagnostic at the public entry', () => {
		// The selected disposition with a-top stretched over the full height of cell a: a-top then
		// walls a-bottom off the left portal, so no allocation has an in-cell corridor for it.
		const prepared = prepareGrid();
		const input = hiddenEndpointInput();
		const selected = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== GridCellLayoutStatus.Selected) throw new Error(selected.reason);
		const normalized = normalize(prepared.graph, input);
		if (typeof normalized === 'string') throw new Error(normalized);
		const model = normalizeGridCellRegionModel(prepared.graph, input, normalized);
		if (model.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Grid model not ready');
		const cells = selected.cells.map((cell) => {
			if (cell.id !== 'a') return cell;
			const elements = cell.localLayout.elements.map((element) => {
				if (element.id !== 'a-top') return element;
				const y = cell.bounds.y - cell.translation.y;
				return { ...element, bounds: { ...element.bounds, y, height: cell.bounds.height } };
			});
			return { ...cell, localLayout: { ...cell.localLayout, elements } };
		});
		const crossing = prepared.graph.relations
			.map(({ relation }) => relation)
			.filter(
				({ from, to }) => input.cellByEndpointId.get(from) !== input.cellByEndpointId.get(to),
			);
		const attempt = routePlacedGridCellDisposition({
			graph: prepared.graph,
			input,
			model: model.model,
			disposition: {
				cells,
				columnWidths: selected.columnWidths,
				rowHeights: selected.rowHeights,
				gridRight: Math.max(...cells.map(({ bounds }) => bounds.x + bounds.width)),
				gridBottom: Math.max(...cells.map(({ bounds }) => bounds.y + bounds.height)),
			},
			resources: gridCrossingResources(input, crossing),
			allocationBudgets: { rowGutter: 1, reallocate: 1, extraTrack: 1, bridge: 1 },
		});
		if (attempt.status !== GridCellLayoutStatus.Unknown)
			throw new Error('The walled crossing should be reported as unknown.');
		expect(attempt.reason).toBe('Cross-cell relation across-grid enters element a-top.');
		const witness = attempt.witness;
		expect(attempt.code).toBe(RegionGeometryDiagnosticCode.GridCrossingEntersElement);
		expect(witness.attempted).toBe(4);
		expect(witness.exhaustive).toBe(false);
		expect(
			witness.rejectedAlternatives.some(
				({ phaseId, code }) =>
					phaseId === CrossingAllocationPhaseId.RowGutter &&
					code === RegionGeometryDiagnosticCode.GridCrossingEntersElement,
			),
		).toBe(true);
		expect(witness.phases[0]?.truncated).toBe(true);
		for (const phase of witness.phases) {
			expect(phase.attempted).toBe(true);
			expect(phase.exploredGeometries).toBe(1);
		}
	});
});

describe('crossing ends inside their own cell', () => {
	const rightToLeft = { direction: LayoutDirection.RightToLeft, bias: LayoutBias.Right };

	const m503Cells = [['c'], ['e'], ['f'], ['g', 'h', 'i'], ['j', 'k', 'l'], ['m', 'n']];
	const m503Locals: readonly (readonly [string, string])[] = [
		['h', 'g'],
		['i', 'g'],
		['k', 'j'],
		['l', 'j'],
	];

	it('renders M5-03 right to left through the row gap above j', async () => {
		const document = persistedCellGrid(2, m503Cells, [...m503Locals, ['j', 'f']], rightToLeft);
		const { layout } = await layoutDocument(document);
		expect([layout.width, layout.height]).toEqual([1600, 1528]);
		const routes = new Map(layout.relations.map((route) => [route.id, route]));
		const face = defined(layout.elements.find(({ id }) => id === 'j')).bounds;
		const target = defined(layout.elements.find(({ id }) => id === 'f')).bounds;
		const points = defined(routes.get('r4')).points;
		// f's cell lies right above j's: r4 leaves j by its top and enters f by its bottom.
		expect(defined(points[0]).y).toBe(face.y);
		expect(defined(points.at(-1)).y).toBe(target.y + target.height);
		expect(points.every(({ x, y }) => y >= target.y + target.height && y <= face.y && x > 0)).toBe(
			true,
		);
		for (const local of ['r2', 'r3'])
			expect(defined(routes.get(local)).points.at(-1)).not.toEqual(points[0]);
	});

	it('moves a gutter crossing port off the arrivals of its local family', async () => {
		// c is two rows above j in the same column: r4 keeps the column gutter and j's left face.
		const document = persistedCellGrid(2, m503Cells, [...m503Locals, ['j', 'c']], rightToLeft);
		const { layout } = await layoutDocument(document);
		const routes = new Map(layout.relations.map((route) => [route.id, route]));
		const face = defined(layout.elements.find(({ id }) => id === 'j')).bounds;
		const port = defined(defined(routes.get('r4')).points[0]);
		const centre = face.y + face.height / 2;
		expect(port.x).toBe(face.x);
		const tracks = (port.y - centre) / 24;
		expect(tracks).not.toBe(0);
		expect(Number.isInteger(tracks)).toBe(true);
		for (const local of ['r2', 'r3'])
			expect(defined(routes.get(local)).points.at(-1)).not.toEqual(port);
	});

	it('lets a crossing target share the arrival point of its local family on a hidden endpoint', async () => {
		// g is diagonal to a: the crossing reaches a by its column's gutter face, behind b.
		const document = persistedCellGrid(
			2,
			[['a', 'b'], ['c', 'd'], ['e', 'f'], ['g']],
			[
				['b', 'a'],
				['g', 'a'],
				['e', 'c'],
			],
			rightToLeft,
		);
		const { layout } = await layoutDocument(document);
		const route = defined(layout.relations.find(({ id }) => id === 'r1'));
		const sibling = defined(layout.elements.find(({ id }) => id === 'b')).bounds;
		expect(route.points.length).toBeGreaterThan(6);
		for (const [index, end] of route.points.slice(1).entries())
			expect(entersInterior(defined(route.points[index]), end, sibling)).toBe(false);
	});
});
