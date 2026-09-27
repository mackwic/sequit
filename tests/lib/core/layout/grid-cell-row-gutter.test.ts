import { describe, expect, it } from 'vitest';

import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	type LogicDocument,
	PERSISTENCE_FORMAT,
} from '../../../../src/lib/core/document/logic-document';
import { orderKey } from '../../../../src/lib/core/document/order-key';
import { routeBridgeAnalysis } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import { RegionGeometryDiagnosticCode } from '../../../../src/lib/core/layout/geometry/region-geometry-diagnostic';
import {
	crossingRowY,
	gridCrossingResources,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import {
	routePlacedGridCellDisposition,
	solveGridCellLayout,
} from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import { normalize } from '../../../../src/lib/core/layout/grids/grid-cell-model';
import { normalizeGridCellRegionModel } from '../../../../src/lib/core/layout/grids/grid-cell-region-model';
import { GridCellLayoutStatus } from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import { RegionCompositionModelStatus } from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	gridDocument,
	gridInput,
	nxmTwoByThreeDocument,
	nxmTwoByThreeInput,
	prepareGrid,
} from './grid-cell-fixture';

function length(points: readonly { x: number; y: number }[]): number {
	return points.slice(1).reduce((sum, point, index) => {
		const previous = defined(points[index]);
		return sum + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
	}, 0);
}

describe('horizontal grid row gutters', () => {
	it.each([false, true])(
		'uses an allocated 2 × 2 gap without adding bends (reverse: %s)',
		(reverse) => {
			const ids = ['r0c0', 'r0c1', 'r1c0', 'r1c1'];
			let from = 'r0c0';
			let to = 'r1c1';
			if (reverse) {
				from = 'r1c1';
				to = 'r0c0';
			}
			const document: LogicDocument = {
				persistenceFormat: PERSISTENCE_FORMAT,
				id: 'grid-row-witness',
				title: 'Grid row witness',
				layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
				natures: [{ id: 'task', label: 'Task', color: '#304050' }],
				groups: [],
				junctions: [],
				nodes: ids.map((id, index) => ({
					kind: EndpointKind.Node as const,
					id,
					natureId: 'task',
					markdown: `${id}\n`,
					layoutOrder: orderKey(`a${index}`),
				})),
				relations: [{ id: 'diagonal', from, to }],
			};
			const input = {
				rootId: '@root',
				cells: ids.map((id, index) => ({
					id,
					parentId: '@root',
					row: Math.floor(index / 2),
					column: index % 2,
				})),
				cellByEndpointId: new Map(ids.map((id) => [id, id])),
				minimumColumnWidths: [180, 180],
				minimumRowHeights: [80, 80],
			};
			const prepared = prepareLayoutDocument(document);
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
			if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
			const route = defined(result.layout.relations.find(({ id }) => id === 'diagonal'));
			const resources = gridCrossingResources(input, document.relations);
			const upper = defined(result.cells.find(({ row }) => row === 0));
			const lower = defined(result.cells.find(({ row }) => row === 1));
			const y = crossingRowY(
				defined(resources.edges.rowGutters[0]),
				upper.bounds.y + upper.bounds.height,
				defined(defined(result.allocation.rowTrackByRelationId)[0]).get('diagonal') ?? -1,
			);
			expect(y).toBe(404);
			expect(y).toBeGreaterThan(upper.bounds.y + upper.bounds.height);
			expect(y).toBeLessThan(lower.bounds.y);
			expect(route.points.slice(3, 5).map((point) => point.y)).toEqual([y, y]);
			expect(length(route.points)).toBe(1516);
			expect(routeBridgeAnalysis(result.layout.relations).crossings).toHaveLength(0);
			expect(routeBridgeAnalysis(result.layout.relations).bridges).toHaveLength(0);
			expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
		},
	);
	it.each([false, true])('routes a crossing close to both cells (reversed: %s)', (reverse) => {
		const source = gridDocument();
		let document = source;
		if (reverse)
			document = {
				...source,
				relations: source.relations.map((relation) => {
					if (relation.id === 'across-grid')
						return { ...relation, from: relation.to, to: relation.from };
					return relation;
				}),
			};
		const prepared = prepareGrid(document);
		const input = gridInput();
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
		const resources = gridCrossingResources(input, [
			defined(document.relations.find(({ id }) => id === 'across-grid')),
		]);
		const track = defined(
			defined(defined(result.allocation.rowTrackByRelationId)[0]).get('across-grid'),
		);
		const y = crossingRowY(
			defined(resources.edges.rowGutters[0]),
			defined(result.cells.find(({ row }) => row === 0)).bounds.y + defined(result.rowHeights[0]),
			track,
		);
		const route = defined(result.layout.relations.find(({ id }) => id === 'across-grid'));
		expect(
			route.points.some(
				(point, index) => point.y === y && index > 2 && index < route.points.length - 3,
			),
		).toBe(true);
		expect(length(route.points)).toBe(2668);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});
	it.each([false, true])(
		'keeps a nonadjacent N × M crossing outside intervening cells (reverse: %s)',
		(reverse) => {
			const source = nxmTwoByThreeDocument();
			let from = 'a';
			let to = 'f';
			if (reverse) {
				from = 'f';
				to = 'a';
			}
			const document = {
				...source,
				relations: [{ id: 'nonadjacent', from, to }],
			};
			const prepared = prepareLayoutDocument(document);
			const input = nxmTwoByThreeInput();
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
			if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
			const resources = gridCrossingResources(input, document.relations);
			expect(resources.rowGutterIds).toEqual([['nonadjacent'], ['nonadjacent']]);
			expect(defined(result.allocation.rowTrackByRelationId)[0]?.get('nonadjacent')).toBe(0);
			const upper = defined(result.cells.find(({ row }) => row === 0));
			const route = defined(result.layout.relations.find(({ id }) => id === 'nonadjacent'));
			expect(route.points[3]?.y).toBe(upper.bounds.y + upper.bounds.height + 48);
			expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
		},
	);
	it('moves a nonadjacent crossing to the second gap after a real route contact', () => {
		const source = nxmTwoByThreeDocument();
		const document = {
			...source,
			relations: [
				{ id: 'a-f', from: 'a', to: 'f' },
				{ id: 'blocker', from: 'b', to: 'd' },
			],
		};
		const input = nxmTwoByThreeInput();
		const resources = gridCrossingResources(input, document.relations);
		expect(resources.rowGutterIds).toEqual([['a-f'], ['a-f']]);
		expect(resources.edges.rowGutters.map(({ capacity }) => capacity)).toEqual([1, 1]);
		const prepared = prepareLayoutDocument(document);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
		expect(result.witness.rejectedAlternatives[0]?.code).toBe(
			RegionGeometryDiagnosticCode.ParentRouteContact,
		);
		expect(result.witness.phases[0]?.totalGeometries).toBe('6');
		expect(result.witness.phases[0]?.exploredGeometries).toBe(2);
		expect(defined(result.allocation.rowTrackByRelationId)[0]?.has('a-f')).toBe(false);
		expect(defined(result.allocation.rowTrackByRelationId)[1]?.get('a-f')).toBe(0);
		const middle = defined(result.cells.find(({ row }) => row === 1));
		const route = defined(result.layout.relations.find(({ id }) => id === 'a-f'));
		const trackY = crossingRowY(
			defined(resources.edges.rowGutters[1]),
			middle.bounds.y + middle.bounds.height,
			0,
		);
		expect(route.points[3]?.y).toBe(trackY);
		expect(routeBridgeAnalysis(result.layout.relations).bridges).toEqual([]);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
		const permuted = prepareLayoutDocument({
			...document,
			relations: [...document.relations].reverse(),
		});
		expect(
			solveGridCellLayout(permuted.graph, permuted.measurements, {
				...input,
				cells: [...input.cells].reverse(),
				cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
			}),
		).toEqual(result);
	});
	it('grows only a loaded row separation and allocates distinct horizontal tracks', () => {
		const source = gridDocument();
		const document = {
			...source,
			relations: [...source.relations, { id: 'another-diagonal', from: 'a-top', to: 'd' }],
		};
		const prepared = prepareGrid(document);
		const input = gridInput();
		const resources = gridCrossingResources(
			input,
			document.relations.filter(({ id }) => id !== 'inside-a'),
		);
		expect(resources.rowGutterIds).toEqual([['across-grid', 'another-diagonal']]);
		expect(resources.edges.rowGutters.map(({ capacity }) => capacity)).toEqual([2]);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
		const upper = defined(result.cells.find(({ row }) => row === 0));
		const lower = defined(result.cells.find(({ row }) => row === 1));
		expect(lower.bounds.y - upper.bounds.y - upper.bounds.height).toBe(120);
		const tracks = defined(defined(result.allocation.rowTrackByRelationId)[0]);
		expect(new Set(tracks.values()).size).toBe(tracks.size);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
	});
	it('reports a missing edge only when the upper-bus fallback is invalid', () => {
		const document = gridDocument();
		const prepared = prepareGrid(document);
		const input = gridInput();
		const selected = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (selected.status !== GridCellLayoutStatus.Selected) throw new Error(selected.reason);
		const normalized = normalize(prepared.graph, input);
		if (typeof normalized === 'string') throw new Error(normalized);
		const model = normalizeGridCellRegionModel(prepared.graph, input, normalized);
		if (model.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Grid model is not ready');
		const crossing = [defined(document.relations.find(({ id }) => id === 'across-grid'))];
		const resources = gridCrossingResources(input, crossing);
		const first = defined(selected.cells.find(({ row }) => row === 0));
		const disposition = {
			cells: selected.cells,
			columnWidths: selected.columnWidths,
			rowHeights: selected.rowHeights,
			gridRight: Math.max(...selected.cells.map(({ bounds }) => bounds.x + bounds.width)),
			gridBottom: Math.max(...selected.cells.map(({ bounds }) => bounds.y + bounds.height)),
		};
		const withoutRow = {
			...resources,
			edges: { ...resources.edges, rowGutters: [] },
		};
		const availableBus = routePlacedGridCellDisposition({
			graph: prepared.graph,
			input,
			model: model.model,
			disposition,
			resources: withoutRow,
		});
		expect(availableBus.status).toBe(GridCellLayoutStatus.Selected);
		const blockedBus = routePlacedGridCellDisposition({
			graph: prepared.graph,
			input,
			model: model.model,
			disposition,
			resources: {
				...withoutRow,
				edges: {
					...withoutRow.edges,
					topBus: { ...withoutRow.edges.topBus, spacing: first.bounds.y + first.bounds.height / 2 },
				},
			},
		});
		expect(blockedBus.status).toBe(GridCellLayoutStatus.Unknown);
		if (blockedBus.status === GridCellLayoutStatus.Unknown)
			expect(blockedBus.code).toBe(RegionGeometryDiagnosticCode.GridRowGutterMissing);
	});
	it('does not charge the row gutter for a same-column relation', () => {
		const source = gridDocument();
		const document = {
			...source,
			relations: source.relations.map((relation) => {
				if (relation.id === 'across-grid') return { ...relation, to: 'c' };
				return relation;
			}),
		};
		const prepared = prepareGrid(document);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, gridInput());
		if (result.status !== GridCellLayoutStatus.Selected) throw new Error(result.reason);
		expect(defined(result.allocation.rowTrackByRelationId)[0]?.has('across-grid')).toBe(false);
		expect(
			defined(result.layout.relations.find(({ id }) => id === 'across-grid')).points,
		).toHaveLength(6);
	});
});
