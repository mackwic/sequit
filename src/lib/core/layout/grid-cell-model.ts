import {
	defined,
	EndpointKind,
	type LogicDocument,
	type LogicRelation,
	REGION_COMPOSITION_PERSISTENCE_FORMAT,
} from '../document/logic-document';
import type { LogicGraph } from '../graph/create-graph';
import type { GridCellDefinition, GridCellInput } from './grid-cell-types';
import type { LayoutMeasurements } from './layout-types';

export interface GridModel {
	readonly cells: readonly GridCellDefinition[];
	readonly localRelations: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossing: readonly LogicRelation[];
}

interface RelationPartition {
	readonly localRelations: ReadonlyMap<string, readonly LogicRelation[]>;
	readonly crossing: readonly LogicRelation[];
}

type RelationEndpoint = LogicGraph['relations'][number]['source'];

function ungroupedNode(endpoint: RelationEndpoint): boolean {
	return endpoint.kind === EndpointKind.Node && endpoint.entity.groupId === undefined;
}

function directGroupMember(graph: LogicGraph, endpoint: RelationEndpoint): boolean {
	if (endpoint.kind !== EndpointKind.Node || endpoint.entity.groupId === undefined) return false;
	const parent = graph.endpointsById.get(endpoint.entity.groupId);
	return parent?.kind === EndpointKind.Group && parent.entity.groupId === undefined;
}

function envelopeFailure(graph: LogicGraph, input: GridCellInput): string | undefined {
	const document = graph.document;
	if (document.presentation !== undefined)
		return 'Persisted lane presentations are outside this grid policy.';
	if (document.regionPresentation !== undefined && document.regionPresentation.grid === undefined)
		return 'Only a persisted grid region presentation can use this grid policy.';
	if (document.junctions.length > 0) return 'Junctions are outside this bounded grid proof.';
	const endpointCount = document.nodes.length + document.groups.length;
	if (endpointCount > 20 || document.relations.length > 20)
		return 'This grid proof accepts at most twenty endpoints and twenty relations.';
	if (input.rootId.length === 0) return 'The root identity must be nonempty.';
	const minima = [...input.minimumColumnWidths, ...input.minimumRowHeights];
	if (minima.some((value) => !Number.isFinite(value) || value < 0))
		return 'Track minima must be finite nonnegative dimensions.';
	return undefined;
}

function validCell(cell: GridCellDefinition, index: number, rootId: string): boolean {
	if (cell.id.length === 0 || cell.id === rootId) return false;
	if (cell.parentId !== rootId) return false;
	if (cell.row !== Math.floor(index / 2)) return false;
	return cell.column === index % 2;
}

function orderedCells(input: GridCellInput): readonly GridCellDefinition[] | string {
	if (input.cells.length !== 4) return 'Exactly four direct child cells are required.';
	const cells = [...input.cells].sort(
		(left, right) => left.row - right.row || left.column - right.column,
	);
	if (cells.some((cell, index) => !validCell(cell, index, input.rootId)))
		return 'Cells must uniquely cover the root two by two grid.';
	if (new Set(cells.map(({ id }) => id)).size !== 4)
		return 'Cells must uniquely cover the root two by two grid.';
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

function crossingEndpointFailure(
	graph: LogicGraph,
	source: RelationEndpoint,
	target: RelationEndpoint,
): string | undefined {
	const nodeEndpoints = source.kind === EndpointKind.Node && target.kind === EndpointKind.Node;
	const groupToNode = source.kind === EndpointKind.Group && target.kind === EndpointKind.Node;
	const nodeToGroup = source.kind === EndpointKind.Node && target.kind === EndpointKind.Group;
	const directGroup = groupToNode || nodeToGroup;
	if (!nodeEndpoints && !directGroup)
		return 'Cross-cell routes currently require ungrouped node endpoints.';
	const sourceGroupedNode =
		source.kind === EndpointKind.Node && source.entity.groupId !== undefined;
	const targetGroupedNode =
		target.kind === EndpointKind.Node && target.entity.groupId !== undefined;
	if (sourceGroupedNode || targetGroupedNode) {
		const internalGrid = graph.document.persistenceFormat === REGION_COMPOSITION_PERSISTENCE_FORMAT;
		const memberToNode =
			(directGroupMember(graph, source) && ungroupedNode(target)) ||
			(directGroupMember(graph, target) && ungroupedNode(source));
		if (!internalGrid || !memberToNode)
			return 'Cross-cell routes currently require ungrouped node endpoints.';
	}
	const sourceNestedGroup =
		source.kind === EndpointKind.Group && source.entity.groupId !== undefined;
	const targetNestedGroup =
		target.kind === EndpointKind.Group && target.entity.groupId !== undefined;
	if (sourceNestedGroup || targetNestedGroup)
		return 'Cross-cell routes to nested groups are outside this bounded grid proof.';
	return undefined;
}

function partitionRelations(
	graph: LogicGraph,
	input: GridCellInput,
	cells: readonly GridCellDefinition[],
): RelationPartition | string {
	const localRelations = new Map(cells.map(({ id }) => [id, [] as LogicRelation[]]));
	const crossing: LogicRelation[] = [];
	for (const { relation, source, target } of graph.relations) {
		const sourceCell = defined(input.cellByEndpointId.get(relation.from));
		const targetCell = defined(input.cellByEndpointId.get(relation.to));
		if (sourceCell === targetCell) {
			defined(localRelations.get(sourceCell)).push(relation);
			continue;
		}
		const failure = crossingEndpointFailure(graph, source, target);
		if (failure !== undefined) return failure;
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
	const relations = partitionRelations(graph, input, cells);
	if (typeof relations === 'string') return relations;
	return { cells, ...relations };
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
