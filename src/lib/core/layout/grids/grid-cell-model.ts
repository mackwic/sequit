import { defined, type LogicDocument, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { LayoutMeasurements } from '../layout-types';
import type { GridCellDefinition, GridCellInput } from './grid-cell-types';

export interface GridModel {
	readonly cells: readonly GridCellDefinition[];
	readonly localRelations: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossing: readonly LogicRelation[];
}

interface RelationPartition {
	readonly localRelations: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossing: readonly LogicRelation[];
}

function envelopeFailure(graph: LogicGraph, input: GridCellInput): string | undefined {
	const document = graph.document;
	if (document.presentation !== undefined)
		return 'Persisted lane presentations are outside this grid policy.';
	if (document.regionPresentation !== undefined && document.regionPresentation.grid === undefined)
		return 'Only a persisted grid region presentation can use this grid policy.';
	if (document.junctions.length > 0) return 'Junctions are outside this bounded grid proof.';
	if (input.rootId.length === 0) return 'The root identity must be nonempty.';
	const minima = [...input.minimumColumnWidths, ...input.minimumRowHeights];
	if (minima.some((value) => !Number.isFinite(value) || value < 0))
		return 'Track minima must be finite nonnegative dimensions.';
	return undefined;
}

/** The rectangle a cell set tiles, when it tiles exactly one. */
export interface GridRectangle {
	readonly rows: number;
	readonly columns: number;
}

/** The rectangle the cells cover, or undefined when they do not tile one exactly. */
export function gridRectangle(
	cells: readonly { readonly row: number; readonly column: number }[],
): GridRectangle | undefined {
	if (cells.length === 0) return undefined;
	let rows = 0;
	let columns = 0;
	for (const cell of cells) {
		if (!Number.isSafeInteger(cell.row) || cell.row < 0) return undefined;
		if (!Number.isSafeInteger(cell.column) || cell.column < 0) return undefined;
		if (cell.row + 1 > rows) rows = cell.row + 1;
		if (cell.column + 1 > columns) columns = cell.column + 1;
	}
	if (rows * columns !== cells.length) return undefined;
	const slots = new Set(cells.map(({ row, column }) => `${row}:${column}`));
	if (slots.size !== cells.length) return undefined;
	return { rows, columns };
}

/**
 * A tiled rectangle already implies that every slot is covered once, so a sorted cell only has to
 * carry an identity distinct from the root and from its siblings.
 */
function validCellIdentity(cell: GridCellDefinition, rootId: string): boolean {
	if (cell.id.length === 0 || cell.id === rootId) return false;
	return cell.parentId === rootId;
}

function orderedCells(input: GridCellInput): readonly GridCellDefinition[] | string {
	if (input.cells.length === 0) return 'At least one direct child cell is required.';
	const cells = [...input.cells].sort(
		(left, right) => left.row - right.row || left.column - right.column,
	);
	const rectangle = gridRectangle(cells);
	if (rectangle === undefined) return 'Cells must uniquely cover the root grid rectangle.';
	if (cells.some((cell) => !validCellIdentity(cell, input.rootId)))
		return 'Cells must uniquely cover the root grid rectangle.';
	if (new Set(cells.map(({ id }) => id)).size !== cells.length)
		return 'Cells must uniquely cover the root grid rectangle.';
	if (
		input.minimumColumnWidths.length !== rectangle.columns ||
		input.minimumRowHeights.length !== rectangle.rows
	)
		return 'Grid track minima must match the cell rectangle.';
	return cells;
}

function ownershipFailure(
	graph: LogicGraph,
	input: GridCellInput,
	cells: readonly GridCellDefinition[],
): string | undefined {
	const document = graph.document;
	const endpointIds = [...document.groups, ...document.nodes].map(({ id }) => id);
	if (input.cellByEndpointId.size !== endpointIds.length)
		return 'Every endpoint must be assigned to exactly one child cell.';
	if (
		endpointIds.some(
			(id) => !cells.some(({ id: cellId }) => cellId === input.cellByEndpointId.get(id)),
		)
	)
		return 'Every endpoint must be assigned to exactly one child cell.';
	if (
		cells.some(
			({ id }) => !document.nodes.some((node) => input.cellByEndpointId.get(node.id) === id),
		)
	)
		return 'Every child cell must contain at least one node.';
	const crossesGroup = (id: string, groupId: string | undefined): boolean =>
		groupId !== undefined && input.cellByEndpointId.get(id) !== input.cellByEndpointId.get(groupId);
	if (document.nodes.some(({ id, groupId }) => crossesGroup(id, groupId)))
		return 'A group and all its members must occupy one indivisible child cell.';
	if (document.groups.some(({ id, groupId }) => crossesGroup(id, groupId)))
		return 'A group and all its members must occupy one indivisible child cell.';
	return undefined;
}

function partitionRelations(
	graph: LogicGraph,
	input: GridCellInput,
	cells: readonly GridCellDefinition[],
): RelationPartition {
	const localRelations = new Map(cells.map(({ id }) => [id, [] as LogicRelation[]]));
	const crossing: LogicRelation[] = [];
	for (const { relation } of graph.relations) {
		const sourceCell = defined(input.cellByEndpointId.get(relation.from));
		const targetCell = defined(input.cellByEndpointId.get(relation.to));
		if (sourceCell === targetCell) {
			defined(localRelations.get(sourceCell)).push(relation);
			continue;
		}
		crossing.push(relation);
	}
	return { localRelations, crossing };
}

export function normalize(graph: LogicGraph, input: GridCellInput): GridModel | string {
	const envelope = envelopeFailure(graph, input);
	if (envelope !== undefined) return envelope;
	const cells = orderedCells(input);
	if (typeof cells === 'string') return cells;
	const ownership = ownershipFailure(graph, input, cells);
	if (ownership !== undefined) return ownership;
	return { cells, ...partitionRelations(graph, input, cells) };
}

export function localDocument(
	graph: LogicGraph,
	input: GridCellInput,
	model: GridModel,
	cell: GridCellDefinition,
): LogicDocument {
	const document = graph.document;
	return {
		persistenceFormat: document.persistenceFormat,
		id: document.id,
		title: document.title,
		layout: cell.layout ?? document.layout,
		natures: document.natures,
		nodes: document.nodes.filter(({ id }) => input.cellByEndpointId.get(id) === cell.id),
		groups: document.groups.filter(({ id }) => input.cellByEndpointId.get(id) === cell.id),
		junctions: [],
		relations: defined(model.localRelations.get(cell.id)),
	};
}

export function localMeasurements(
	document: LogicDocument,
	all: LayoutMeasurements,
): LayoutMeasurements {
	const nodes = new Map<string, { readonly width: number; readonly height: number }>();
	const groups = new Map<
		string,
		{
			readonly minimumWidth: number;
			readonly minimumHeight: number;
			readonly headerHeight: number;
			readonly padding: number;
		}
	>();
	for (const { id } of document.nodes) {
		const measured = defined(all.nodes.get(id));
		nodes.set(id, measured);
	}
	for (const { id } of document.groups) {
		groups.set(id, defined(all.groups.get(id)));
	}
	return {
		nodes,
		groups,
		junctions: new Map(),
	};
}
