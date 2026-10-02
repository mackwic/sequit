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
import { createAdjacency } from './create-adjacency';
import { documentaryRelations } from './documentary-relations';
import { findCycle } from './find-cycle';

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

export type GraphEndpoint = GraphNodeEndpoint | GraphGroupEndpoint | GraphJunctionEndpoint;

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
	DuplicateRelationId = 'duplicate-relation-id',
	UnknownEndpoint = 'unknown-endpoint',
	Cycle = 'cycle',
	GroupCycle = 'group-cycle',
	GraphTooComplex = 'graph-too-complex',
}

export const MAX_CACHED_EXPANDED_GROUP_MEMBERSHIPS = 100_000;
export const MAX_EFFECTIVE_DEPENDENCY_PAIRS = 100_000;

interface GraphSuccess {
	readonly ok: true;
	readonly value: LogicGraph;
}

interface GraphFailure {
	readonly ok: false;
	readonly diagnostics: readonly GraphDiagnostic[];
}

export type GraphResult = GraphSuccess | GraphFailure;

function collectRelations(
	document: LogicDocument,
	endpointsById: ReadonlyMap<string, GraphEndpoint>,
	diagnostics: GraphDiagnostic[],
): GraphRelation[] {
	const relations: GraphRelation[] = [];
	let previousId: string | undefined;
	let reportedDuplicateId: string | undefined;
	for (const relation of [...document.relations].sort((left, right) =>
		compareCanonicalStrings(left.id, right.id),
	)) {
		if (relation.id === previousId) {
			if (relation.id !== reportedDuplicateId)
				diagnostics.push({
					code: GraphDiagnosticCode.DuplicateRelationId,
					message: `Duplicate relation id: ${relation.id}`,
					path: ['relations', relation.id],
				});
			reportedDuplicateId = relation.id;
			continue;
		}
		previousId = relation.id;
		const source = endpointsById.get(relation.from);
		const target = endpointsById.get(relation.to);
		if (!source) diagnostics.push(unknownEndpointDiagnostic(relation, 'from'));
		if (!target) diagnostics.push(unknownEndpointDiagnostic(relation, 'to'));
		if (source && target) relations.push({ relation, source, target });
	}
	return documentaryRelations(
		relations,
		[...endpointsById.values()].map(({ entity }) => entity),
	);
}

function unknownEndpointDiagnostic(
	relation: LogicRelation,
	field: keyof { from: unknown; to: unknown },
): GraphDiagnostic {
	const role = field === 'from' ? 'source' : 'target';
	return {
		code: GraphDiagnosticCode.UnknownEndpoint,
		message: `Unknown relation ${role}: ${relation[field]}`,
		path: ['relations', relation.id, field],
	};
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

interface GroupExpansionFrame {
	readonly groupId: string;
	readonly expanded: Set<string>;
	nextMember: number;
}

interface GroupExpansionContext {
	readonly endpointsById: ReadonlyMap<string, GraphEndpoint>;
	readonly directMembersByGroupId: ReadonlyMap<string, readonly string[]>;
	readonly cache: Map<string, readonly string[]>;
	readonly diagnostics: GraphDiagnostic[];
	cachedMemberships: number;
}

function visitGroupMember(
	frame: GroupExpansionFrame,
	frames: GroupExpansionFrame[],
	context: GroupExpansionContext,
): void {
	const directMembers = defined(context.directMembersByGroupId.get(frame.groupId));
	const memberId = defined(directMembers[frame.nextMember]);
	frame.nextMember += 1;
	const member = context.endpointsById.get(memberId);
	if (member?.kind !== EndpointKind.Group) {
		frame.expanded.add(memberId);
		return;
	}
	const cachedMembers = context.cache.get(memberId);
	if (cachedMembers !== undefined) {
		for (const id of cachedMembers) frame.expanded.add(id);
		return;
	}
	frames.push({ groupId: memberId, expanded: new Set(), nextMember: 0 });
}

function expandGroup(
	groupId: string,
	context: GroupExpansionContext,
): readonly string[] | undefined {
	const cached = context.cache.get(groupId);
	if (cached !== undefined) return cached;
	const frames: GroupExpansionFrame[] = [{ groupId, expanded: new Set(), nextMember: 0 }];
	while (frames.length > 0 && context.diagnostics.length === 0) {
		const frame = defined(frames.at(-1));
		const directMembers = defined(context.directMembersByGroupId.get(frame.groupId));
		if (frame.nextMember < directMembers.length) {
			visitGroupMember(frame, frames, context);
			continue;
		}
		const expanded = [...frame.expanded].sort(compareCanonicalStrings);
		if (context.cachedMemberships + expanded.length > MAX_CACHED_EXPANDED_GROUP_MEMBERSHIPS) {
			context.diagnostics.push({
				code: GraphDiagnosticCode.GraphTooComplex,
				message: `Expanded group memberships exceed ${MAX_CACHED_EXPANDED_GROUP_MEMBERSHIPS}`,
				path: ['groups', frame.groupId],
			});
			break;
		}
		context.cachedMemberships += expanded.length;
		context.cache.set(frame.groupId, expanded);
		frames.pop();
		const parentFrame = frames.at(-1);
		if (!parentFrame) continue;
		for (const id of expanded) parentFrame.expanded.add(id);
	}
	return context.cache.get(groupId);
}

function collectEffectiveRelations(
	relations: readonly GraphRelation[],
	effectiveEndpointIds: (endpointId: string) => readonly string[],
): EffectiveSemanticRelation[] | GraphDiagnostic {
	const effectiveRelations: EffectiveSemanticRelation[] = [];
	let dependencyPairs = 0;
	for (const { relation, source, target } of relations) {
		const sourceIds = effectiveEndpointIds(source.entity.id);
		const targetIds = effectiveEndpointIds(target.entity.id);
		dependencyPairs += sourceIds.length * targetIds.length;
		if (dependencyPairs > MAX_EFFECTIVE_DEPENDENCY_PAIRS) {
			return {
				code: GraphDiagnosticCode.GraphTooComplex,
				message: `Effective dependency pairs exceed ${MAX_EFFECTIVE_DEPENDENCY_PAIRS}`,
				path: ['relations', relation.id],
			};
		}
		effectiveRelations.push({ relationId: relation.id, sourceIds, targetIds });
	}
	return effectiveRelations;
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
	const groupCycle =
		document.groups.length === 0
			? undefined
			: findCycle(
					[...endpointsById.keys()],
					new Map(
						[...endpointsById.keys()].map((id) => [id, directMembersByGroupId.get(id) ?? []]),
					),
				);
	if (groupCycle)
		return {
			ok: false,
			diagnostics: [
				{
					code: GraphDiagnosticCode.GroupCycle,
					message: `Group nesting cycle: ${groupCycle.join(' -> ')}`,
					path: ['groups', defined(groupCycle.at(-2)), 'group'],
					cycle: groupCycle,
				},
			],
		};
	const expansionContext: GroupExpansionContext = {
		endpointsById,
		directMembersByGroupId,
		cache: expandedGroupMembers,
		diagnostics,
		cachedMemberships: 0,
	};
	const effectiveIdsByEndpoint = new Map<string, readonly string[]>();
	function effectiveEndpointIds(endpointId: string): readonly string[] {
		const known = effectiveIdsByEndpoint.get(endpointId);
		if (known !== undefined) return known;
		const endpoint = endpointsById.get(endpointId);
		let ids: readonly string[] = [endpointId];
		if (endpoint?.kind === EndpointKind.Group) {
			const expanded = expandGroup(endpointId, expansionContext) ?? [];
			if (expanded.length > 0) ids = expanded;
		}
		effectiveIdsByEndpoint.set(endpointId, ids);
		return ids;
	}

	const effectiveRelations = collectEffectiveRelations(relations, effectiveEndpointIds);
	if (diagnostics.length > 0) return { ok: false, diagnostics };
	if (!Array.isArray(effectiveRelations)) return { ok: false, diagnostics: [effectiveRelations] };
	const rankableEndpointIds = new Set([
		...[...document.nodes, ...document.junctions].map(({ id }) => id),
		...relations.flatMap(({ source, target }) => [source.entity.id, target.entity.id]),
	]);
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
