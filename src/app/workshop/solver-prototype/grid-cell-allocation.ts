import { compareCanonicalStrings } from '../../../lib/core/canonical-string';
import type { LogicDocument, LogicRelation } from '../../../lib/core/document/logic-document';
import {
	defined,
	EndpointKind,
	LayoutBias,
	LayoutDirection,
	PERSISTENCE_FORMAT,
} from '../../../lib/core/document/logic-document';
import { orderKey } from '../../../lib/core/document/order-key';
import { gridMargin } from '../../../lib/core/layout/grids/grid-cell-crossing';
import type { CrossingAllocationPhaseId } from '../../../lib/core/layout/grids/grid-cell-crossing-phases';
import { gridCrossingResources } from '../../../lib/core/layout/grids/grid-cell-crossing-resources';
import { solveGridCellLayout } from '../../../lib/core/layout/grids/grid-cell-layout';
import {
	type GridCellAllocationSelected,
	type GridCellInput,
	GridCellLayoutStatus,
} from '../../../lib/core/layout/grids/grid-cell-types';
import type { LayoutMeasurements } from '../../../lib/core/layout/layout-types';
import { requireDemoGraph, requireSelectedDemoResult } from './demo-result';

const ROUTE_COLORS = ['#bf4f36', '#287b65', '#4c5fb5', '#a34e91', '#b17b26', '#317c9e'];

interface GridAllocationTrackView {
	readonly relationId: string;
	readonly color: string;
	readonly routeTrackLabel: string;
	readonly railLabel: string;
}

export interface GridAllocationDemo {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly selected: GridCellAllocationSelected;
	readonly colorsByRelationId: ReadonlyMap<string, string>;
	readonly tracks: readonly GridAllocationTrackView[];
	readonly busOrder: readonly string[];
	readonly winningPhase: CrossingAllocationPhaseId;
	readonly sizeBefore: { readonly width: number; readonly height: number };
}

interface GridDefinition {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly endpointIds: readonly string[];
	readonly cells: GridCellInput['cells'];
	readonly cellByEndpointId: GridCellInput['cellByEndpointId'];
	readonly minimumColumnWidths: readonly number[];
	readonly minimumRowHeights: readonly number[];
	readonly relations: readonly LogicRelation[];
}

function documentFor(definition: GridDefinition): LogicDocument {
	return {
		persistenceFormat: PERSISTENCE_FORMAT,
		id: definition.id,
		title: definition.title,
		layout: { direction: LayoutDirection.TopToBottom, bias: LayoutBias.Top },
		natures: [{ id: 'task', label: 'Task', color: '#304050' }],
		groups: [],
		junctions: [],
		nodes: definition.endpointIds.map((id, index) => ({
			kind: EndpointKind.Node,
			id,
			natureId: 'task',
			markdown: `${id.toUpperCase()}\n`,
			layoutOrder: orderKey(`a${index}`),
		})),
		relations: definition.relations,
	};
}

function measurements(endpointIds: readonly string[]): LayoutMeasurements {
	return {
		nodes: new Map(endpointIds.map((id) => [id, { width: 120, height: 64 }])),
		groups: new Map(),
		junctions: new Map(),
	};
}

function gridInput(definition: GridDefinition): GridCellInput {
	return {
		rootId: '@root',
		cells: definition.cells,
		cellByEndpointId: definition.cellByEndpointId,
		minimumColumnWidths: definition.minimumColumnWidths,
		minimumRowHeights: definition.minimumRowHeights,
	};
}

function cell(id: string, row: number, column: number): GridCellInput['cells'][number] {
	return { id, parentId: '@root', row, column };
}

function twoByTwo(): GridDefinition {
	const endpointIds = ['a', 'b', 'c', 'd'];
	const cells = [cell('A', 0, 0), cell('B', 0, 1), cell('C', 1, 0), cell('D', 1, 1)];
	return {
		id: 'grid-allocation-2x2',
		title: 'Grille deux par deux',
		description: 'Une traversée diagonale : le candidat canonique reste le premier choix valide.',
		endpointIds,
		cells,
		cellByEndpointId: new Map([
			['a', 'A'],
			['b', 'B'],
			['c', 'C'],
			['d', 'D'],
		]),
		minimumColumnWidths: [180, 140],
		minimumRowHeights: [90, 90],
		relations: [{ id: 'a-d', from: 'a', to: 'd' }],
	};
}

function threeByTwo(conflictsFirst: boolean): GridDefinition {
	const endpointIds = ['a', 'b', 'c', 'd', 'e', 'f'];
	const cellIds = ['a', 'b', 'c', 'd', 'e', 'f'];
	const relations: LogicRelation[] = [];
	const cellByEndpointId = new Map<string, string>();
	let id: string;
	let title: string;
	let description: string;
	if (conflictsFirst) {
		id = 'grid-allocation-3x2-conflicts-first';
		title = 'Grille trois par deux · conflits d’abord';
		description =
			'Les conflits guident les premiers essais avant le parcours complet : la réaffectation suffit sans pont. Nœuds d’atelier : 120 × 64 px ; témoin moteur : 220 × 116 px.';
		relations.push(
			{ id: 'a-b', from: 'a', to: 'b' },
			{ id: 'a-c', from: 'a', to: 'c' },
			{ id: 'c-f', from: 'c', to: 'f' },
		);
		for (const endpointId of endpointIds) cellByEndpointId.set(endpointId, endpointId);
	} else {
		id = 'grid-allocation-row-gutter';
		title = 'Gouttière horizontale et bus';
		description =
			'La relation a-d traverse la gouttière entre rangées ; a-b et a-c conservent le bus supérieur.';
		relations.push(
			{ id: 'a-b', from: 'a', to: 'b' },
			{ id: 'a-c', from: 'a', to: 'c' },
			{ id: 'a-d', from: 'a', to: 'd' },
		);
		for (const [endpointId, cellId] of [
			['a', 'a'],
			['b', 'd'],
			['c', 'c'],
			['d', 'f'],
			['e', 'b'],
			['f', 'e'],
		] as const)
			cellByEndpointId.set(endpointId, cellId);
	}
	return {
		id,
		title,
		description,
		endpointIds,
		cells: cellIds.map((cellId, index) => cell(cellId, Math.floor(index / 3), index % 3)),
		cellByEndpointId,
		minimumColumnWidths: [180, 120, 140],
		minimumRowHeights: [70, 90],
		relations,
	};
}

function gridTracks(
	definition: GridDefinition,
	selected: GridCellAllocationSelected,
	colorsByRelationId: ReadonlyMap<string, string>,
): readonly GridAllocationTrackView[] {
	const relationById = new Map(definition.relations.map((relation) => [relation.id, relation]));
	return [...selected.allocation.busTrackByRelationId]
		.sort((left, right) => compareCanonicalStrings(left[0], right[0]))
		.map(([relationId]) => {
			const relation = defined(relationById.get(relationId));
			let routeTrackLabel: string | undefined;
			for (const [row, tracks] of (selected.allocation.rowTrackByRelationId ?? []).entries()) {
				const track = tracks.get(relationId);
				if (track !== undefined) routeTrackLabel = `gouttière R${row + 1}·${track}`;
			}
			routeTrackLabel ??= `bus ${defined(selected.allocation.busTrackByRelationId.get(relationId))}`;
			const columns = new Set([
				defined(
					selected.cells.find(({ id }) => id === definition.cellByEndpointId.get(relation.from)),
				).column,
				defined(
					selected.cells.find(({ id }) => id === definition.cellByEndpointId.get(relation.to)),
				).column,
			]);
			const rails = [...columns]
				.sort((left, right) => left - right)
				.map(
					(column) =>
						`G${column + 1}·${defined(selected.allocation.gutterTrackByRelationId[column]).get(relationId)}`,
				);
			return {
				relationId,
				color: defined(colorsByRelationId.get(relationId)),
				routeTrackLabel,
				railLabel: rails.join(' / '),
			};
		});
}

function solveDemo(definition: GridDefinition): GridAllocationDemo {
	const source = documentFor(definition);
	const graph = requireDemoGraph(source, `Grid workshop example ${definition.id}`);
	const input = gridInput(definition);
	const attempt = solveGridCellLayout(graph, measurements(definition.endpointIds), input);
	requireSelectedDemoResult(
		attempt,
		GridCellLayoutStatus.Selected,
		`Grid workshop example ${definition.id}`,
	);
	const relationIds = definition.relations.map(({ id }) => id).sort(compareCanonicalStrings);
	const colorsByRelationId = new Map(
		relationIds.map((relationId, index) => [
			relationId,
			defined(ROUTE_COLORS[index % ROUTE_COLORS.length]),
		]),
	);
	// Compare identical solved cell tracks against the former global crossing-count margin.
	const globalMargin = gridMargin(gridCrossingResources(input, definition.relations).edges);
	const columns = attempt.columnWidths.length;
	const rows = attempt.rowHeights.length;
	const sizeBefore = {
		width:
			attempt.columnWidths.reduce((sum, width) => sum + width, 0) +
			2 * globalMargin +
			96 +
			Math.max(0, columns - 2) * Math.max(96, globalMargin),
		height:
			attempt.rowHeights.reduce((sum, height) => sum + height, 0) +
			Math.max(0, rows - 1) * 96 +
			2 * globalMargin,
	};
	const horizontalIds = new Set(
		(attempt.allocation.rowTrackByRelationId ?? []).flatMap((tracks) => [...tracks.keys()]),
	);
	const busOrder = [...attempt.allocation.busTrackByRelationId]
		.filter(([relationId]) => !horizontalIds.has(relationId))
		.sort((left, right) => left[1] - right[1])
		.map(([relationId]) => relationId);
	return {
		id: definition.id,
		title: definition.title,
		description: definition.description,
		selected: attempt,
		colorsByRelationId,
		tracks: gridTracks(definition, attempt, colorsByRelationId),
		busOrder,
		winningPhase: attempt.witness.winningPhase,
		sizeBefore,
	};
}

/** Pure, deterministic production-solver cases for the grid track-allocation workshop. */
export function gridCrossingAllocationDemos(): readonly GridAllocationDemo[] {
	return [solveDemo(twoByTwo()), solveDemo(threeByTwo(true)), solveDemo(threeByTwo(false))];
}
