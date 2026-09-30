import { describe, expect, it } from 'vitest';

import { validatedBridges } from '../../../../src/lib/core/layout/bridges/bridge-oracle';
import {
	crossingEndpointSide,
	crossingIncidence,
	crossingRailX,
	reservedRailTrack,
} from '../../../../src/lib/core/layout/grids/grid-cell-crossing';
import { crossingAllocationCandidatesWithExtraTrack } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-allocation';
import { CrossingAllocationPhaseId } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { crossingAllocationGeometryCount } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-phases';
import { gridCrossingResources } from '../../../../src/lib/core/layout/grids/grid-cell-crossing-resources';
import { occupiedGridGutterColumns } from '../../../../src/lib/core/layout/grids/grid-cell-inherited-incident';
import { solveGridCellLayout } from '../../../../src/lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../../src/lib/core/layout/grids/grid-cell-types';
import { validateGridCellGeometry } from '../../../../src/lib/core/layout/grids/grid-cell-validation';
import type { RecursiveContext } from '../../../../src/lib/core/layout/regions/composition/nested-region-recursive-model-adapter';
import {
	normalizeRegionCompositionModel,
	RegionCompositionModelStatus,
} from '../../../../src/lib/core/layout/regions/model/region-composition-model';
import {
	RegionCompositionStatus,
	RegionPortalSide,
} from '../../../../src/lib/core/layout/regions/model/region-composition-types';
import { incidentEndpointPositions } from '../../../../src/lib/core/layout/regions/model/region-incident-contract';
import { solveRecursiveNestedRegionLayout } from '../../../../src/lib/core/layout/regions/recursive/nested-region-recursive-layout';
import { validateNestedRegionLeafIncidentsMessage as validateNestedRegionLeafIncidents } from '../../../../src/lib/core/layout/regions/validation/nested-region-leaf-incident-validation';
import { validateRegionCompositionGeometryMessage as validateRegionCompositionGeometry } from '../../../../src/lib/core/layout/regions/validation/region-composition-validation';
import { nestedRegionInput } from '../../../../src/lib/core/layout/root-region';
import { prepareLayoutDocument } from '../../../support/harnesses/layout';
import {
	nxmThreeByTwoDocument,
	nxmThreeByTwoInput,
	nxmTwoByThreeDocument,
	nxmTwoByThreeInput,
	persistedNxmGridDocument,
	persistedNxmInnerGridDocument,
} from './grid-cell-fixture';

interface NxmShape {
	readonly name: string;
	readonly document: () => ReturnType<typeof nxmThreeByTwoDocument>;
	readonly input: () => GridCellInput;
	readonly columns: number;
	readonly rows: number;
}

const SHAPES: readonly NxmShape[] = [
	{
		name: 'three by two',
		document: nxmThreeByTwoDocument,
		input: nxmThreeByTwoInput,
		columns: 3,
		rows: 2,
	},
	{
		name: 'two by three',
		document: nxmTwoByThreeDocument,
		input: nxmTwoByThreeInput,
		columns: 2,
		rows: 3,
	},
];

describe('grid bus allocation', () => {
	it('charges endpoint gutters in relation input order, once per shared-column crossing', () => {
		const input = nxmThreeByTwoInput();
		const crossing = nxmThreeByTwoDocument().relations;
		const resources = gridCrossingResources(input, crossing);
		expect(resources.gutterIds).toEqual([['a-b', 'a-c'], ['a-b'], ['a-c', 'c-f']]);
		expect(resources.edges.gutters.map(({ capacity }) => capacity)).toEqual([3, 2, 3]);
		expect(resources.edges.topBus.capacity).toBe(3);
		const reversed = gridCrossingResources(
			{
				...input,
				cells: [...input.cells].reverse(),
				cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
			},
			[...crossing].reverse(),
		);
		expect(reversed.edges).toEqual(resources.edges);
		expect(reversed.gutterIds).toEqual([['a-c', 'a-b'], ['a-b'], ['c-f', 'a-c']]);
	});
	it('selects a noncanonical bus after every canonical order fails without row alternatives', () => {
		const source = {
			...nxmThreeByTwoDocument(),
			relations: [
				{ id: 'r0', from: 'a', to: 'b' },
				{ id: 'r1', from: 'a', to: 'c' },
				{ id: 'r2', from: 'b', to: 'c' },
			],
		};
		const input = nxmThreeByTwoInput();
		const resources = gridCrossingResources(input, source.relations);
		expect(resources.rowGutterIds).toEqual([[]]);
		const crossingIds = source.relations.map(({ id }) => id);
		const busInput = {
			...resources,
			rowGutterIds: [],
			crossingIds,
			busRelevantRelationIds: crossingIds,
			incidence: crossingIncidence(source.relations),
			portalByRelationId: new Map(),
		};
		// Count the complete small search space when it fits the counting budget.
		expect(crossingAllocationGeometryCount(busInput, 0, 385)).toBe(384n);
		expect(crossingAllocationGeometryCount(busInput, 0, 256)).toBe(257n);
		const prepared = prepareLayoutDocument(source);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`${result.status}: ${result.reason}`);
		expect(result.allocation.rowTrackByRelationId?.[0]?.size ?? 0).toBe(0);
		const order = [...result.allocation.busTrackByRelationId]
			.sort((left, right) => left[1] - right[1])
			.map(([id]) => id);
		expect(order).toEqual(['r1', 'r0', 'r2']);
		const phase = result.witness.phases[1];
		expect(result.witness.phases[0]?.exhaustive).toBe(true);
		expect(phase?.exhaustive).toBe(false);
		expect(phase).toMatchObject({
			totalGeometries: '257',
			totalGeometriesKind: 'lower-bound',
		});
		expect(phase?.exploredGeometries).toBeLessThan(256);
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Reallocate);
		expect(
			result.witness.rejectedAlternatives.filter(
				({ phaseId, busOrder }) =>
					phaseId === CrossingAllocationPhaseId.Reallocate && busOrder.join() === 'r0,r1,r2',
			),
		).toHaveLength(64);
		expect(validatedBridges(result.layout.relations)).toEqual([]);
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
		const permuted = prepareLayoutDocument({
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
		});
		expect(
			solveGridCellLayout(permuted.graph, permuted.measurements, {
				...input,
				cells: [...input.cells].reverse(),
				cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
			}),
		).toEqual(result);
	});
});

describe('N by M grid composition', () => {
	it.each(SHAPES)(
		'places and routes the $name grid through the production composition and validators',
		({ document, input, columns, rows }) => {
			const source = document();
			const cellInput = input();
			const prepared = prepareLayoutDocument(source);
			const result = solveGridCellLayout(prepared.graph, prepared.measurements, cellInput);
			if (result.status !== GridCellLayoutStatus.Selected)
				throw new Error(`${result.status}: ${result.reason}`);
			expect(result.columnWidths).toHaveLength(columns);
			expect(result.rowHeights).toHaveLength(rows);
			expect(result.cells).toHaveLength(columns * rows);
			expect(result.cells.map(({ row, column }) => `${row}:${column}`)).toEqual(
				Array.from({ length: rows }, (_, row) =>
					Array.from({ length: columns }, (_, column) => `${row}:${column}`),
				).flat(),
			);
			// Every cell fills exactly the tracks of its row and column.
			for (const cell of result.cells) {
				expect(cell.bounds.width).toBe(result.columnWidths[cell.column]);
				expect(cell.bounds.height).toBe(result.rowHeights[cell.row]);
			}
			expect(validateGridCellGeometry(result, prepared.graph, cellInput)).toBeUndefined();
		},
	);

	it('reserves loaded gutters, routes the inner crossing and ignores input permutation', () => {
		const source = nxmThreeByTwoDocument();
		const input = nxmThreeByTwoInput();
		const prepared = prepareLayoutDocument(source);
		const result = solveGridCellLayout(prepared.graph, prepared.measurements, input);
		if (result.status !== GridCellLayoutStatus.Selected)
			throw new Error(`${result.status}: ${result.reason}`);
		const columns = [0, 1, 2].map((column) =>
			result.cells.find((cell) => cell.row === 0 && cell.column === column),
		);
		const [first, middle, last] = columns;
		if (first === undefined || middle === undefined || last === undefined)
			throw new Error('Expected three top-row cells.');
		const leftGap = middle.bounds.x - first.bounds.x - first.bounds.width;
		const innerGap = last.bounds.x - middle.bounds.x - middle.bounds.width;
		expect([
			first.bounds.x,
			leftGap,
			innerGap,
			result.layout.width - last.bounds.x - last.bounds.width,
		]).toEqual([120, 96, 96, 120]);
		expect(result.layout.width).toBe(result.columnWidths.reduce((sum, width) => sum + width, 432));
		expect(result.layout.height).toBe(result.rowHeights.reduce((sum, height) => sum + height, 336));
		expect(validateGridCellGeometry(result, prepared.graph, input)).toBeUndefined();
		const resources = gridCrossingResources(input, source.relations);
		for (const [column, ids] of resources.gutterIds.entries()) {
			const cell = columns[column];
			const edge = resources.edges.gutters[column];
			const tracks = result.allocation.gutterTrackByRelationId[column];
			if (cell === undefined || edge === undefined || tracks === undefined)
				throw new Error('Expected a placed gutter.');
			for (const id of ids) {
				const side = crossingEndpointSide(column, columns.length);
				let frameX = cell.bounds.x + cell.bounds.width;
				if (side === RegionPortalSide.Left) frameX = cell.bounds.x;
				const track = tracks.get(id);
				if (track === undefined) throw new Error('Missing crossing track.');
				const railX = crossingRailX(edge, frameX, side, track);
				expect(
					result.layout.relations
						.find((route) => route.id === id)
						?.points.some(({ x }) => x === railX),
				).toBe(true);
				expect(Math.abs(railX - frameX)).toBeGreaterThanOrEqual(24);
			}
		}
		for (const route of result.layout.relations) {
			const ports = result.portals.filter(({ relationId }) => relationId === route.id);
			expect(ports).toHaveLength(2);
		}
		expect(result.witness.winningPhase).toBe(CrossingAllocationPhaseId.Reallocate);
		const reallocation = result.witness.phases[1];
		if (reallocation === undefined) throw new Error('Missing reallocation evidence.');
		expect(reallocation.selected).toBe(true);
		expect(reallocation.exploredGeometries).toBeLessThan(256);
		expect(reallocation.totalGeometries).toBe('96');
		expect(reallocation.totalGeometriesKind).toBe('exact');
		expect(result.witness.phases.slice(2).every(({ attempted }) => !attempted)).toBe(true);
		expect(validatedBridges(result.layout.relations)).toHaveLength(0);
		const firstColumn = result.cells.find(({ column }) => column === 0);
		const secondColumn = result.cells.find(({ column }) => column === 1);
		if (firstColumn === undefined || secondColumn === undefined)
			throw new Error('Expected the two leading columns.');
		const route = result.layout.relations.find(({ id }) => id === 'a-b');
		if (route === undefined) throw new Error('Expected the inward crossing.');
		const innerGutter = route.points.some(
			({ x }) => x > firstColumn.bounds.x + firstColumn.bounds.width && x < secondColumn.bounds.x,
		);
		expect(innerGutter).toBe(true);
		const permuted = prepareLayoutDocument({
			...source,
			nodes: [...source.nodes].reverse(),
			relations: [...source.relations].reverse(),
		});
		const permutedInput: GridCellInput = {
			...input,
			cells: [...input.cells].reverse(),
			cellByEndpointId: new Map([...input.cellByEndpointId].reverse()),
		};
		const permutedMeasurements = {
			...permuted.measurements,
			nodes: new Map([...permuted.measurements.nodes].reverse()),
		};
		expect(solveGridCellLayout(permuted.graph, permutedMeasurements, permutedInput)).toEqual(
			result,
		);
	});
});

describe('N by M grid region arrangement', () => {
	it('composes the persisted three by two grid through the recursive arrangement', () => {
		const prepared = prepareLayoutDocument(persistedNxmGridDocument(), undefined);
		const attempt = solveRecursiveNestedRegionLayout(
			prepared.graph,
			prepared.measurements,
			nestedRegionInput(prepared.graph),
		);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`${attempt.status}: ${attempt.reason}`);
		expect(attempt.regions).toHaveLength(6);
		expect(attempt.layout.relations).toHaveLength(3);
		const columns = new Map(attempt.regions.map(({ id, bounds }) => [id, bounds.x]));
		expect(columns.get('a')).toBe(columns.get('d'));
		expect(columns.get('b')).toBe(columns.get('e'));
		expect(columns.get('c')).toBe(columns.get('f'));
		expect(columns.get('a')).toBeLessThan(columns.get('b') ?? 0);
		expect(columns.get('b')).toBeLessThan(columns.get('c') ?? 0);
	});

	it('continues an inherited middle-column incident on its own reserved gutter beside owned crossings', () => {
		const source = persistedNxmInnerGridDocument();
		const withCrossings = {
			...source,
			relations: [...source.relations, ...nxmThreeByTwoDocument().relations],
		};
		const prepared = prepareLayoutDocument(withCrossings);
		const input = nestedRegionInput(prepared.graph);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`${attempt.status}: ${attempt.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a normalized inner grid.');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
		const middle = attempt.regions.find(({ id }) => id === 'b');
		const route = attempt.layout.relations.find(({ id }) => id === 'b-out');
		if (middle === undefined || route === undefined) throw new Error('Missing inherited rail.');
		const cellInput = nxmThreeByTwoInput();
		const resources = gridCrossingResources(cellInput, nxmThreeByTwoDocument().relations);
		const edge = resources.edges.gutters[1];
		if (edge === undefined) throw new Error('Missing middle-column gutter.');
		const localRail = crossingRailX(
			edge,
			middle.bounds.x,
			crossingEndpointSide(1, 3),
			reservedRailTrack(edge),
		);
		const grid = attempt.regions.find(({ id }) => id === 'grid');
		if (grid === undefined) throw new Error('Missing parent grid.');
		expect(route.points.some(({ x }) => x === localRail)).toBe(true);
		// The reserved rail is already occupied by b-out. A phase-piste candidate must not
		// allocate that same rail to a-b, even if other column gutters can still grow.
		const context = {
			graph: prepared.graph,
			model: normalized.model,
			measurements: prepared.measurements,
			cache: undefined,
			endpointPositions: incidentEndpointPositions(prepared.graph.document),
			ownershipByRelationId: new Map(
				normalized.model.relations.map((owned) => [owned.relation.id, owned]),
			),
		} satisfies RecursiveContext;
		const blockedExtraGutterColumns = occupiedGridGutterColumns(
			context,
			'grid',
			new Map([['b-out', [RegionPortalSide.Left]]]),
			cellInput.cells,
		);
		expect([...blockedExtraGutterColumns]).toEqual([1]);
		const crossing = nxmThreeByTwoDocument().relations;
		const allocationInput = {
			edges: resources.edges,
			crossingIds: crossing.map(({ id }) => id),
			busRelevantRelationIds: ['a-b', 'a-c'],
			gutterIds: resources.gutterIds,
			incidence: crossingIncidence(crossing),
			portalByRelationId: new Map(),
			blockedExtraGutterColumns,
		};
		const unconstrained = [
			...crossingAllocationCandidatesWithExtraTrack({
				...allocationInput,
				blockedExtraGutterColumns: undefined,
			}),
		];
		expect(
			unconstrained.some((candidate) =>
				[...(candidate.gutterTrackByRelationId[1] ?? new Map()).values()].includes(
					reservedRailTrack(edge),
				),
			),
		).toBe(true);
		const candidates = [...crossingAllocationCandidatesWithExtraTrack(allocationInput)];
		expect(BigInt(candidates.length)).toBe(crossingAllocationGeometryCount(allocationInput, 1));
		expect(candidates.length).toBeGreaterThan(0);
		for (const candidate of candidates)
			expect([...(candidate.gutterTrackByRelationId[1] ?? new Map()).values()]).not.toContain(
				reservedRailTrack(edge),
			);
	});

	it('keeps the reserved outer track in an empty crossing gutter for an inherited incident', () => {
		const source = persistedNxmInnerGridDocument();
		const withCrossing = {
			...source,
			relations: [
				{ id: 'a-b', from: 'a', to: 'b' },
				{ id: 'c-out', from: 'c', to: 'outside' },
			],
		};
		const prepared = prepareLayoutDocument(withCrossing);
		const input = nestedRegionInput(prepared.graph);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`${attempt.status}: ${attempt.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a normalized grid.');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
		const cell = attempt.regions.find(({ id }) => id === 'c');
		const route = attempt.layout.relations.find(({ id }) => id === 'c-out');
		if (cell === undefined || route === undefined) throw new Error('Missing outer incident.');
		const resources = gridCrossingResources(nxmThreeByTwoInput(), [
			{ id: 'a-b', from: 'a', to: 'b' },
		]);
		const gutter = resources.edges.gutters[2];
		if (gutter === undefined) throw new Error('Missing outer gutter.');
		expect(gutter.capacity).toBe(1);
		const railX = crossingRailX(
			gutter,
			cell.bounds.x + cell.bounds.width,
			RegionPortalSide.Right,
			reservedRailTrack(gutter),
		);
		expect(route.points.some(({ x }) => x === railX)).toBe(true);
	});

	it('carries an inner-grid incident from its middle column to the sibling leaf', () => {
		const source = persistedNxmInnerGridDocument();
		const prepared = prepareLayoutDocument(source, undefined);
		const input = nestedRegionInput(prepared.graph);
		const attempt = solveRecursiveNestedRegionLayout(prepared.graph, prepared.measurements, input);
		if (attempt.status !== RegionCompositionStatus.Selected)
			throw new Error(`${attempt.status}: ${attempt.reason}`);
		const normalized = normalizeRegionCompositionModel(prepared.graph, input);
		if (normalized.status !== RegionCompositionModelStatus.Ready)
			throw new Error('Expected a normalized inner grid.');
		expect(validateRegionCompositionGeometry(normalized.model, attempt)).toBeUndefined();
		expect(validateNestedRegionLeafIncidents(normalized.model, attempt)).toBeUndefined();
		// The middle-column cell is column 1 of 3 and is the only cell without an incident node.
		expect(
			attempt.regions.filter(({ id }) => ['a', 'b', 'c', 'd', 'e', 'f'].includes(id)),
		).toHaveLength(6);
		const middle = new Map(attempt.regions.map(({ id, bounds }) => [id, bounds]));
		expect(middle.get('b')?.x).toBe(middle.get('e')?.x);
		expect(middle.get('a')?.x).toBeLessThan(middle.get('b')?.x ?? 0);
		expect(middle.get('b')?.x).toBeLessThan(middle.get('c')?.x ?? 0);
		const route = attempt.layout.relations.find(({ id }) => id === 'b-out');
		if (route === undefined) throw new Error('Expected the middle-column incident.');
		// The route climbs the middle column gutter above the cells before it leaves the grid.
		const above = route.points.filter(({ y }) => y < (middle.get('a')?.y ?? 0));
		expect(above.length).toBeGreaterThanOrEqual(2);
	});
});
