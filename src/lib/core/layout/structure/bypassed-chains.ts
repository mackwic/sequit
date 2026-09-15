import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { RankedComponent } from './placement-rows';

export interface BypassedChain {
	readonly ids: readonly string[];
	readonly links: readonly LogicRelation[];
	readonly bypass: LogicRelation;
}

function chainIn(
	ids: readonly string[],
	outgoing: ReadonlyMap<string, readonly LogicRelation[]>,
): BypassedChain | undefined {
	const first = defined(ids[0]);
	const last = defined(ids.at(-1));
	if ((outgoing.get(first)?.length ?? 0) !== 0) return undefined;
	const links: LogicRelation[] = [];
	for (let index = 1; index < ids.length; index += 1) {
		const id = defined(ids[index]);
		const relations = outgoing.get(id) ?? [];
		let expected = 1;
		if (id === last) expected = 2;
		if (relations.length !== expected) return undefined;
		const link = relations.find(({ to }) => to === ids[index - 1]);
		if (link === undefined) return undefined;
		links.push(link);
	}
	const bypass = outgoing.get(last)?.find(({ to }) => to === first);
	if (bypass === undefined) return undefined;
	return { ids, links, bypass };
}

/** A whole component in one containment context, with an ordinary chain and its direct bypass. */
export function bypassedChains(
	graph: LogicGraph,
	components: readonly RankedComponent[],
	ranks: ReadonlyMap<string, number>,
): readonly BypassedChain[] {
	const outgoing = new Map<string, LogicRelation[]>();
	for (const { relation } of graph.relations) {
		const links = outgoing.get(relation.from) ?? [];
		links.push(relation);
		outgoing.set(relation.from, links);
	}
	const chains: BypassedChain[] = [];
	for (const component of components) {
		if (component.ids.length < 3) continue;
		const endpoints = component.ids.map((id) => defined(graph.endpointsById.get(id)));
		if (endpoints.some(({ kind }) => kind !== EndpointKind.Node)) continue;
		const contexts = new Set(endpoints.map(({ entity }) => entity.groupId));
		if (contexts.size !== 1) continue;
		const ids = [...component.ids].sort((a, b) => defined(ranks.get(a)) - defined(ranks.get(b)));
		if (ids.some((id, index) => ranks.get(id) !== index)) continue;
		const chain = chainIn(ids, outgoing);
		if (chain !== undefined) chains.push(chain);
	}
	return chains;
}
