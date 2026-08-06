import type {
	LogicDocument,
	LogicGroup,
	LogicJunction,
	LogicNode,
	LogicRelation,
} from '../document/logic-document';

type GraphEndpoint =
	| { readonly kind: 'node'; readonly entity: LogicNode }
	| { readonly kind: 'group'; readonly entity: LogicGroup }
	| { readonly kind: 'junction'; readonly entity: LogicJunction };

interface GraphRelation {
	readonly relation: LogicRelation;
	readonly source: GraphEndpoint;
	readonly target: GraphEndpoint;
}

export interface LogicGraph {
	readonly document: LogicDocument;
	readonly endpointsById: ReadonlyMap<string, GraphEndpoint>;
	readonly relations: readonly GraphRelation[];
	readonly rankableEndpointIds: readonly string[];
	readonly outgoingByEndpointId: ReadonlyMap<string, readonly string[]>;
	readonly predecessorsByEndpointId: ReadonlyMap<string, readonly string[]>;
}

interface GraphDiagnostic {
	readonly code: 'unknown-endpoint' | 'cycle';
	readonly message: string;
	readonly path: readonly string[];
	readonly cycle?: readonly string[];
}

export type GraphResult =
	| { readonly ok: true; readonly value: LogicGraph }
	| { readonly ok: false; readonly diagnostics: readonly GraphDiagnostic[] };

function findCycle(
	endpointIds: readonly string[],
	outgoingByEndpointId: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
	const state = new Map<string, 'visiting' | 'visited'>();
	const stack: string[] = [];
	function visit(id: string): readonly string[] | undefined {
		state.set(id, 'visiting');
		stack.push(id);
		const targets = outgoingByEndpointId.get(id);
		/* istanbul ignore if -- @preserve: adjacency is initialized for every canonical endpoint. */
		if (!targets) throw new Error(`Missing graph adjacency: ${id}`);
		for (const target of targets) {
			const targetState = state.get(target);
			if (targetState === 'visiting') {
				const start = stack.lastIndexOf(target);
				return [...stack.slice(start), target];
			}
			if (targetState !== 'visited') {
				const cycle = visit(target);
				if (cycle) return cycle;
			}
		}
		stack.pop();
		state.set(id, 'visited');
		return undefined;
	}

	for (const id of endpointIds) {
		if (state.has(id)) continue;
		const cycle = visit(id);
		if (cycle) return cycle;
	}
	return undefined;
}

interface ResolvedRelations {
	readonly relations: GraphRelation[];
	readonly diagnostics: GraphDiagnostic[];
}

function resolveRelations(
	document: LogicDocument,
	endpointsById: ReadonlyMap<string, GraphEndpoint>,
): ResolvedRelations {
	const diagnostics: GraphDiagnostic[] = [];
	const relations: GraphRelation[] = [];
	for (const relation of [...document.relations].sort((left, right) =>
		left.id.localeCompare(right.id),
	)) {
		const source = endpointsById.get(relation.from);
		const target = endpointsById.get(relation.to);
		if (!source) {
			diagnostics.push({
				code: 'unknown-endpoint',
				message: `Unknown relation source: ${relation.from}`,
				path: ['relations', relation.id, 'from'],
			});
		}
		if (!target) {
			diagnostics.push({
				code: 'unknown-endpoint',
				message: `Unknown relation target: ${relation.to}`,
				path: ['relations', relation.id, 'to'],
			});
		}
		if (source && target) relations.push({ relation, source, target });
	}
	return { relations, diagnostics };
}

interface RankingIdsContext {
	readonly endpointsById: ReadonlyMap<string, GraphEndpoint>;
	readonly memberIdsByGroup: ReadonlyMap<string, readonly string[]>;
	readonly cache: Map<string, readonly string[]>;
}

function rankingIdsFor(context: RankingIdsContext, endpointId: string): readonly string[] {
	const cached = context.cache.get(endpointId);
	if (cached) return cached;
	const endpoint = context.endpointsById.get(endpointId);
	/* istanbul ignore if -- @preserve: ranking IDs are requested only for known endpoints. */
	if (!endpoint) throw new Error(`Missing graph endpoint: ${endpointId}`);
	let rankingIds: readonly string[] = [endpointId];
	if (endpoint.kind === 'group') {
		const members = context.memberIdsByGroup.get(endpointId);
		/* istanbul ignore if -- @preserve: member lists are initialized for every group. */
		if (!members) throw new Error(`Missing group members: ${endpointId}`);
		let expandsNestedGroup = false;
		for (const memberId of members) {
			const member = context.endpointsById.get(memberId);
			if (member?.kind === 'group' && (context.memberIdsByGroup.get(memberId)?.length ?? 0) > 0) {
				expandsNestedGroup = true;
				break;
			}
		}
		if (members.length > 0 && !expandsNestedGroup) {
			rankingIds = members;
		} else if (members.length > 0) {
			rankingIds = [
				...new Set(members.flatMap((memberId) => rankingIdsFor(context, memberId))),
			].sort((left, right) => left.localeCompare(right));
		}
	}
	context.cache.set(endpointId, rankingIds);
	return rankingIds;
}

export function createGraph(document: LogicDocument): GraphResult {
	const endpoints = [
		...document.groups.map((entity) => ({ kind: 'group' as const, entity })),
		...document.nodes.map((entity) => ({ kind: 'node' as const, entity })),
		...document.junctions.map((entity) => ({ kind: 'junction' as const, entity })),
	].sort((left, right) => left.entity.id.localeCompare(right.entity.id));
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.entity.id, endpoint]));
	const { relations, diagnostics } = resolveRelations(document, endpointsById);
	if (diagnostics.length > 0) return { ok: false, diagnostics };

	const memberIdsByGroup = new Map(document.groups.map(({ id }) => [id, [] as string[]]));
	for (const endpoint of endpoints) {
		const groupId = endpoint.entity.groupId;
		if (groupId !== undefined) memberIdsByGroup.get(groupId)?.push(endpoint.entity.id);
	}
	for (const members of memberIdsByGroup.values()) {
		members.sort((left, right) => left.localeCompare(right));
	}
	const rankingContext: RankingIdsContext = {
		endpointsById,
		memberIdsByGroup,
		cache: new Map(),
	};

	const rankableEndpointIds = new Set<string>();
	for (const node of document.nodes) rankableEndpointIds.add(node.id);
	for (const junction of document.junctions) rankableEndpointIds.add(junction.id);
	const rankingTargetsBySourceId = new Map<string, Set<string>>();
	for (const { source, target } of relations) {
		const sourceIds = rankingIdsFor(rankingContext, source.entity.id);
		const targetIds = rankingIdsFor(rankingContext, target.entity.id);
		for (const sourceId of sourceIds) {
			rankableEndpointIds.add(sourceId);
			let rankingTargets = rankingTargetsBySourceId.get(sourceId);
			if (!rankingTargets) {
				rankingTargets = new Set();
				rankingTargetsBySourceId.set(sourceId, rankingTargets);
			}
			for (const targetId of targetIds) {
				rankableEndpointIds.add(targetId);
				rankingTargets.add(targetId);
			}
		}
	}
	const canonicalIds = [...rankableEndpointIds].sort((left, right) => left.localeCompare(right));
	const outgoingByEndpointId = new Map(canonicalIds.map((id) => [id, [] as string[]]));
	const predecessorsByEndpointId = new Map(canonicalIds.map((id) => [id, [] as string[]]));
	for (const sourceId of canonicalIds) {
		const targetIds = rankingTargetsBySourceId.get(sourceId);
		if (targetIds === undefined) continue;
		const outgoing = outgoingByEndpointId.get(sourceId);
		/* istanbul ignore if -- @preserve: adjacency is initialized for every canonical endpoint. */
		if (outgoing === undefined) throw new Error(`Missing graph adjacency: ${sourceId}`);
		for (const targetId of targetIds) {
			outgoing.push(targetId);
			predecessorsByEndpointId.get(targetId)?.push(sourceId);
		}
	}
	for (const adjacent of outgoingByEndpointId.values()) {
		adjacent.sort((left, right) => left.localeCompare(right));
	}

	const cycle = findCycle(canonicalIds, outgoingByEndpointId);
	if (cycle) {
		return {
			ok: false,
			diagnostics: [
				{
					code: 'cycle',
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
			rankableEndpointIds: canonicalIds,
			outgoingByEndpointId,
			predecessorsByEndpointId,
		},
	};
}
