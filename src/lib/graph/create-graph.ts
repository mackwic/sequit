import { compareCanonicalStrings } from '../canonical-string';
import type {
	LogicDocument,
	LogicGroup,
	LogicJunction,
	LogicNode,
	LogicRelation,
} from '../document/logic-document';
import { defined } from '../document/logic-document';
import { EndpointKind } from '../document/logic-document';

interface GraphNodeEndpoint {
	readonly kind: EndpointKind.Node;
	readonly entity: LogicNode;
}
interface GraphGroupEndpoint {
	readonly kind: EndpointKind.Group;
	readonly entity: LogicGroup;
}
interface GraphJunctionEndpoint {
	readonly kind: EndpointKind.Junction;
	readonly entity: LogicJunction;
}
type GraphEndpoint = GraphNodeEndpoint | GraphGroupEndpoint | GraphJunctionEndpoint;

interface GraphRelation {
	readonly relation: LogicRelation;
	readonly source: GraphEndpoint;
	readonly target: GraphEndpoint;
}

export interface EffectiveSemanticRelation {
	readonly relationId: string;
	readonly sourceIds: readonly string[];
	readonly targetIds: readonly string[];
}

export interface LogicGraph {
	readonly document: LogicDocument;
	readonly endpointsById: ReadonlyMap<string, GraphEndpoint>;
	readonly relations: readonly GraphRelation[];
	readonly effectiveRelations: readonly EffectiveSemanticRelation[];
	readonly rankableEndpointIds: readonly string[];
	readonly outgoingByEndpointId: ReadonlyMap<string, readonly string[]>;
	readonly predecessorsByEndpointId: ReadonlyMap<string, readonly string[]>;
}

export interface GraphDiagnostic {
	readonly code: GraphDiagnosticCode;
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
}

export enum GraphDiagnosticCode {
	UnknownEndpoint = 'unknown-endpoint',
	Cycle = 'cycle',
	GroupCycle = 'group-cycle',
}

interface GraphSuccess {
	readonly ok: true;
	readonly value: LogicGraph;
}

interface GraphFailure {
	readonly ok: false;
	readonly diagnostics: readonly GraphDiagnostic[];
}

export type GraphResult = GraphSuccess | GraphFailure;

enum VisitState {
	Visiting = 'visiting',
	Visited = 'visited',
}

function findCycle(
	endpointIds: readonly string[],
	outgoingByEndpointId: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
	// FIXME: Persisted input can contain a valid chain deep enough to exhaust the call stack.
	// Use an explicit DFS frame stack while preserving the deterministic cycle path.
	const state = new Map<string, VisitState>();
	const stack: string[] = [];
	function visit(id: string): readonly string[] | undefined {
		state.set(id, VisitState.Visiting);
		stack.push(id);
		for (const target of defined(outgoingByEndpointId.get(id))) {
			if (state.get(target) === VisitState.Visiting) {
				const start = stack.lastIndexOf(target);
				return [...stack.slice(start), target];
			}
			if (state.get(target) === VisitState.Visited) continue;
			const cycle = visit(target);
			if (cycle) return cycle;
		}
		stack.pop();
		state.set(id, VisitState.Visited);
		return undefined;
	}

	for (const id of endpointIds) {
		if (state.has(id)) continue;
		const cycle = visit(id);
		if (cycle) return cycle;
	}
	return undefined;
}

function collectRelations(
	document: LogicDocument,
	endpointsById: ReadonlyMap<string, GraphEndpoint>,
	diagnostics: GraphDiagnostic[],
): GraphRelation[] {
	const relations: GraphRelation[] = [];
	for (const relation of [...document.relations].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		const source = endpointsById.get(relation.from);
		const target = endpointsById.get(relation.to);
		if (!source) {
			diagnostics.push({
				code: GraphDiagnosticCode.UnknownEndpoint,
				message: `Unknown relation source: ${relation.from}`,
				path: ['relations', relation.id, 'from'],
			});
		}
		if (!target) {
			diagnostics.push({
				code: GraphDiagnosticCode.UnknownEndpoint,
				message: `Unknown relation target: ${relation.to}`,
				path: ['relations', relation.id, 'to'],
			});
		}
		if (source && target) relations.push({ relation, source, target });
	}
	return relations;
}

function collectDirectGroupMembers(document: LogicDocument): Map<string, string[]> {
	const membersByGroupId = new Map(document.groups.map(({ id }) => [id, [] as string[]]));
	const groupedEndpoints = [...document.groups, ...document.nodes, ...document.junctions];
	for (const endpoint of groupedEndpoints) {
		if (endpoint.groupId !== undefined) membersByGroupId.get(endpoint.groupId)?.push(endpoint.id);
	}
	for (const members of membersByGroupId.values()) members.sort(compareCanonicalStrings);
	return membersByGroupId;
}

function adjacencyEndpointIds(
	relation: GraphRelation,
	effectiveRelation: EffectiveSemanticRelation,
): { readonly sourceIds: readonly string[]; readonly targetIds: readonly string[] } {
	const { sourceIds, targetIds } = effectiveRelation;
	const groupEndpoint =
		relation.source.kind === EndpointKind.Group || relation.target.kind === EndpointKind.Group;
	if (!groupEndpoint || !sourceIds.some((id) => targetIds.includes(id))) {
		return effectiveRelation;
	}
	return { sourceIds: [relation.source.entity.id], targetIds: [relation.target.entity.id] };
}

function appendUniqueAdjacency(
	keys: readonly string[],
	adjacentIds: readonly string[],
	adjacency: Map<string, string[]>,
): void {
	for (const key of keys) {
		const values = defined(adjacency.get(key));
		for (const adjacentId of adjacentIds) {
			if (!values.includes(adjacentId)) values.push(adjacentId);
		}
	}
}

function createAdjacency(
	endpointIds: readonly string[],
	relations: readonly GraphRelation[],
	effectiveRelations: readonly EffectiveSemanticRelation[],
): {
	readonly outgoing: Map<string, string[]>;
	readonly predecessors: Map<string, string[]>;
} {
	const outgoing = new Map(endpointIds.map((id) => [id, [] as string[]]));
	const predecessors = new Map(endpointIds.map((id) => [id, [] as string[]]));
	for (let index = 0; index < effectiveRelations.length; index += 1) {
		const effectiveRelation = defined(effectiveRelations[index]);
		const graphRelation = defined(relations[index]);
		const { sourceIds, targetIds } = adjacencyEndpointIds(graphRelation, effectiveRelation);
		appendUniqueAdjacency(sourceIds, targetIds, outgoing);
		appendUniqueAdjacency(targetIds, sourceIds, predecessors);
	}
	for (const adjacent of [...outgoing.values(), ...predecessors.values()]) {
		adjacent.sort(compareCanonicalStrings);
	}
	return { outgoing, predecessors };
}

export function createGraph(document: LogicDocument): GraphResult {
	const endpoints: GraphEndpoint[] = [
		...document.groups.map((entity): GraphGroupEndpoint => ({ kind: EndpointKind.Group, entity })),
		...document.nodes.map((entity): GraphNodeEndpoint => ({ kind: EndpointKind.Node, entity })),
		...document.junctions.map((entity): GraphJunctionEndpoint => ({
			kind: EndpointKind.Junction,
			entity,
		})),
	].sort((left, right) => compareCanonicalStrings(left.entity.id, right.entity.id));
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.entity.id, endpoint]));
	const diagnostics: GraphDiagnostic[] = [];
	const relations = collectRelations(document, endpointsById, diagnostics);
	if (diagnostics.length > 0) return { ok: false, diagnostics };

	const directMembersByGroupId = collectDirectGroupMembers(document);
	const expandedGroupMembers = new Map<string, readonly string[]>();
	const expandingGroups: string[] = [];
	// FIXME: Deep but acyclic untrusted group nesting can exhaust the call stack. Replace
	// this recursion with iterative post-order expansion and retain group-cycle diagnostics.
	function effectiveEndpointIds(
		endpointId: string,
		preserveDirectEmptyGroup = false,
	): readonly string[] {
		const endpoint = endpointsById.get(endpointId);
		if (endpoint?.kind !== EndpointKind.Group) return [endpointId];
		const cached = expandedGroupMembers.get(endpointId);
		if (cached) return cached.length === 0 && preserveDirectEmptyGroup ? [endpointId] : cached;
		const cycleStart = expandingGroups.indexOf(endpointId);
		if (cycleStart >= 0) {
			const cycle = [...expandingGroups.slice(cycleStart), endpointId];
			diagnostics.push({
				code: GraphDiagnosticCode.GroupCycle,
				message: `Group nesting cycle: ${cycle.join(' -> ')}`,
				path: ['groups', defined(expandingGroups.at(-1)), 'group'],
				cycle,
			});
			return [];
		}
		const directMembers = defined(directMembersByGroupId.get(endpointId));
		if (directMembers.length === 0) {
			expandedGroupMembers.set(endpointId, []);
			return [];
		}
		expandingGroups.push(endpointId);
		const expanded = [
			...new Set(directMembers.flatMap((memberId) => effectiveEndpointIds(memberId))),
		].sort(compareCanonicalStrings);
		expandingGroups.pop();
		expandedGroupMembers.set(endpointId, expanded);
		return expanded;
	}
	for (const group of document.groups) effectiveEndpointIds(group.id);
	if (diagnostics.length > 0) return { ok: false, diagnostics };
	const effectiveRelations: EffectiveSemanticRelation[] = [];
	for (const { relation, source, target } of relations) {
		const sourceIds = [...new Set(effectiveEndpointIds(source.entity.id, true))].sort(
			compareCanonicalStrings,
		);
		const targetIds = [...new Set(effectiveEndpointIds(target.entity.id, true))].sort(
			compareCanonicalStrings,
		);
		effectiveRelations.push({ relationId: relation.id, sourceIds, targetIds });
	}
	const rankableEndpointIds = new Set<string>();
	for (const node of document.nodes) rankableEndpointIds.add(node.id);
	for (const junction of document.junctions) rankableEndpointIds.add(junction.id);
	for (const { sourceIds, targetIds } of effectiveRelations) {
		for (const id of sourceIds) rankableEndpointIds.add(id);
		for (const id of targetIds) rankableEndpointIds.add(id);
	}
	for (const { source, target } of relations) {
		rankableEndpointIds.add(source.entity.id);
		rankableEndpointIds.add(target.entity.id);
	}
	const canonicalIds = [...rankableEndpointIds].sort(compareCanonicalStrings);
	const { outgoing: outgoingByEndpointId, predecessors: predecessorsByEndpointId } =
		createAdjacency(canonicalIds, relations, effectiveRelations);

	const cycle = findCycle(canonicalIds, outgoingByEndpointId);
	if (cycle) {
		return {
			ok: false,
			diagnostics: [
				{
					code: GraphDiagnosticCode.Cycle,
					message: `Cycle detected: ${cycle.join(' -> ')}`,
					path: ['relations'],
					cycle,
				},
			],
		};
	}

	return {
		ok: true,
		value: {
			document,
			endpointsById,
			relations,
			effectiveRelations,
			rankableEndpointIds: canonicalIds,
			outgoingByEndpointId,
			predecessorsByEndpointId,
		},
	};
}
