import type {
	LogicDocument,
	LogicGroup,
	LogicJunction,
	LogicNode,
	LogicRelation,
} from '../document/logic-document';

export type GraphEndpoint =
	| { readonly kind: 'node'; readonly entity: LogicNode }
	| { readonly kind: 'group'; readonly entity: LogicGroup }
	| { readonly kind: 'junction'; readonly entity: LogicJunction };

export interface GraphRelation {
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

export interface GraphDiagnostic {
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
			if (state.get(target) === 'visiting') {
				const start = stack.lastIndexOf(target);
				return [...stack.slice(start), target];
			}
			if (state.get(target) !== 'visited') {
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

export function createGraph(document: LogicDocument): GraphResult {
	const endpoints = [
		...document.groups.map((entity) => ({ kind: 'group' as const, entity })),
		...document.nodes.map((entity) => ({ kind: 'node' as const, entity })),
		...document.junctions.map((entity) => ({ kind: 'junction' as const, entity })),
	].sort((left, right) => left.entity.id.localeCompare(right.entity.id));
	const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.entity.id, endpoint]));
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
	if (diagnostics.length > 0) return { ok: false, diagnostics };

	const memberIdsByGroup = new Map(document.groups.map(({ id }) => [id, [] as string[]]));
	for (const endpoint of endpoints) {
		const groupId = endpoint.entity.groupId;
		if (groupId !== undefined) memberIdsByGroup.get(groupId)?.push(endpoint.entity.id);
	}
	for (const members of memberIdsByGroup.values()) {
		members.sort((left, right) => left.localeCompare(right));
	}
	const rankingIdsByEndpointId = new Map<string, readonly string[]>();
	function rankingIdsFor(endpointId: string): readonly string[] {
		const cached = rankingIdsByEndpointId.get(endpointId);
		if (cached) return cached;
		const endpoint = endpointsById.get(endpointId);
		/* istanbul ignore if -- @preserve: ranking IDs are requested only for known endpoints. */
		if (!endpoint) throw new Error(`Missing graph endpoint: ${endpointId}`);
		let memberIds: readonly string[] = [];
		if (endpoint.kind === 'group') {
			const members = memberIdsByGroup.get(endpointId);
			/* istanbul ignore if -- @preserve: member lists are initialized for every group. */
			if (!members) throw new Error(`Missing group members: ${endpointId}`);
			memberIds = members;
		}
		const rankingIds =
			memberIds.length === 0
				? [endpointId]
				: [...new Set(memberIds.flatMap((memberId) => rankingIdsFor(memberId)))].sort(
						(left, right) => left.localeCompare(right),
					);
		rankingIdsByEndpointId.set(endpointId, rankingIds);
		return rankingIds;
	}

	const rankableEndpointIds = new Set<string>();
	for (const node of document.nodes) rankableEndpointIds.add(node.id);
	for (const junction of document.junctions) rankableEndpointIds.add(junction.id);
	const rankingTargetsBySourceId = new Map<string, Set<string>>();
	for (const { source, target } of relations) {
		const sourceIds = rankingIdsFor(source.entity.id);
		const targetIds = rankingIdsFor(target.entity.id);
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
	for (const [sourceId, targetIds] of rankingTargetsBySourceId) {
		for (const targetId of targetIds) {
			outgoingByEndpointId.get(sourceId)?.push(targetId);
			predecessorsByEndpointId.get(targetId)?.push(sourceId);
		}
	}
	for (const adjacent of outgoingByEndpointId.values()) {
		adjacent.sort((left, right) => left.localeCompare(right));
	}
	for (const adjacent of predecessorsByEndpointId.values()) {
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
