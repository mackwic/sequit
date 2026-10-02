import {
	defined,
	type LogicGroup,
	type LogicJunction,
	type LogicNode,
	type LogicRelation,
} from '../../document/logic-document';
import { createGraph, type LogicGraph } from '../../graph/create-graph';
import { topologicallyRank, type TopologicalRanks } from '../../graph/topological-ranks';
import type { LayoutMeasurements } from '../layout-types';
import { inheritGroupBlocks } from '../structure/group-blocks';
import type { LayoutStructure } from '../structure/prepare-layout';

export interface RankSearchComponent {
	readonly index: number;
	readonly ids: readonly string[];
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly measurements: LayoutMeasurements;
	readonly relationCount: number;
}

interface ComponentParts {
	readonly ids: readonly string[];
	readonly groups: LogicGroup[];
	readonly nodes: LogicNode[];
	readonly junctions: LogicJunction[];
	readonly relations: LogicRelation[];
}

function groupOwners(
	graph: LogicGraph,
	byEndpoint: ReadonlyMap<string, number>,
): ReadonlyMap<string, ReadonlySet<number>> {
	const groups = new Map(graph.document.groups.map((group) => [group.id, group]));
	const owners = new Map<string, Set<number>>();
	function retain(index: number, ancestor: string | undefined): void {
		let id = ancestor;
		while (id !== undefined) {
			const indices = owners.get(id) ?? new Set<number>();
			if (indices.has(index)) break;
			indices.add(index);
			owners.set(id, indices);
			id = defined(groups.get(id)).groupId;
		}
	}
	for (const endpoint of [...graph.document.nodes, ...graph.document.junctions]) {
		const index = byEndpoint.get(endpoint.id);
		if (index !== undefined) retain(index, endpoint.groupId);
	}
	for (const group of graph.document.groups) {
		const index = byEndpoint.get(group.id);
		if (index !== undefined) retain(index, group.id);
	}
	return owners;
}

/** Receives one component holding a relation; returning `false` stops the visit. */
type RelationHolderVisitor = (relationIndex: number, holder: number) => boolean;

interface HolderContext {
	readonly byEndpoint: ReadonlyMap<string, number>;
	readonly owners: ReadonlyMap<string, ReadonlySet<number>>;
	readonly visit: RelationHolderVisitor;
}

function holds(context: HolderContext, index: number, id: string): boolean {
	return context.byEndpoint.get(id) === index || context.owners.get(id)?.has(index) === true;
}

/** Visit the components holding one relation; `false` once the visitor stops. */
function visitHolders(
	context: HolderContext,
	relationIndex: number,
	relation: LogicRelation,
): boolean {
	const groupHolders = context.owners.get(relation.from);
	if (groupHolders === undefined) {
		const holder = context.byEndpoint.get(relation.from);
		if (holder === undefined || !holds(context, holder, relation.to)) return true;
		return context.visit(relationIndex, holder);
	}
	for (const holder of groupHolders)
		if (holds(context, holder, relation.to) && !context.visit(relationIndex, holder)) return false;
	return true;
}

/**
 * Visit the components whose local document keeps both endpoints of each relation, by relation
 * index. A relation between two groups is projected onto their members: it belongs to the
 * component of the members, where each populated group stands as the block of its members.
 */
function visitRelationHolders(graph: LogicGraph, context: HolderContext): void {
	for (let relationIndex = 0; relationIndex < graph.relations.length; relationIndex += 1) {
		const { relation } = defined(graph.relations[relationIndex]);
		if (!visitHolders(context, relationIndex, relation)) return;
	}
}

/** The rank components holding each relation, in relation order, as `rankSearchComponents` does. */
export function visitRelationComponents(
	graph: LogicGraph,
	byEndpoint: ReadonlyMap<string, number>,
	visit: RelationHolderVisitor,
): void {
	visitRelationHolders(graph, { byEndpoint, owners: groupOwners(graph, byEndpoint), visit });
}

/** Partition the document once; a shared enclosing group is retained in each local context. */
export function rankSearchComponents(
	graph: LogicGraph,
	structure: LayoutStructure,
	measurements: LayoutMeasurements,
	indices: ReadonlySet<number>,
): readonly RankSearchComponent[] {
	const byEndpoint = new Map<string, number>();
	const parts = new Map<number, ComponentParts>();
	for (const index of indices) {
		const ids = defined(structure.components[index]).ids;
		parts.set(index, {
			ids,
			groups: [],
			nodes: [],
			junctions: [],
			relations: [],
		});
		for (const id of ids) byEndpoint.set(id, index);
	}
	const owners = groupOwners(graph, byEndpoint);
	for (const node of graph.document.nodes)
		parts.get(byEndpoint.get(node.id) ?? -1)?.nodes.push(node);
	for (const junction of graph.document.junctions)
		parts.get(byEndpoint.get(junction.id) ?? -1)?.junctions.push(junction);
	for (const group of graph.document.groups)
		for (const index of owners.get(group.id) ?? []) defined(parts.get(index)).groups.push(group);
	visitRelationHolders(graph, {
		byEndpoint,
		owners,
		visit: (relationIndex, holder) => {
			defined(parts.get(holder)).relations.push(defined(graph.relations[relationIndex]).relation);
			return true;
		},
	});
	return [...parts].map(([index, part]) => {
		const document = {
			...graph.document,
			groups: part.groups,
			nodes: part.nodes,
			junctions: part.junctions,
			relations: part.relations,
		};
		const created = createGraph(document);
		if (!created.ok) throw new Error('A weak component of a valid graph must remain valid');
		const local = created.value;
		inheritGroupBlocks(local, graph);
		return {
			index,
			ids: part.ids,
			graph: local,
			ranks: topologicallyRank(local),
			measurements: {
				nodes: new Map(part.nodes.map(({ id }) => [id, defined(measurements.nodes.get(id))])),
				junctions: new Map(
					part.junctions.map(({ id }) => [id, defined(measurements.junctions.get(id))]),
				),
				groups: new Map(part.groups.map(({ id }) => [id, defined(measurements.groups.get(id))])),
			},
			relationCount: part.relations.length,
		};
	});
}
