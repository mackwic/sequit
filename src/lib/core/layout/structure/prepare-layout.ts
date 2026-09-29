import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { orderEndpoints } from '../../ordering/endpoint-order';
import { type BranchAnchor, branchAnchors } from './branch-anchors';
import { groupBlocks } from './group-blocks';
import { type GroupHierarchy, prepareGroupHierarchy } from './group-hierarchy';
import { type JunctionPlacement, prepareJunctions } from './junction-structure';
import { containmentComponents, rankedComponents } from './layout-components';
import { preparePlacementRows, type RankedComponent } from './placement-rows';

export interface LayoutStructure {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly maximumRank: number;
	readonly junctionIds: ReadonlySet<string>;
	readonly junctions: ReadonlyMap<string, JunctionPlacement>;
	readonly branchAnchors: ReadonlyMap<string, BranchAnchor>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly components: readonly RankedComponent[];
	readonly containment: readonly (readonly string[])[] | undefined;
}

function componentContext(
	graph: LogicGraph,
	ids: readonly string[],
	hierarchy: GroupHierarchy | undefined,
): string {
	const contexts = new Set<string>();
	for (const id of ids) {
		const groupId = graph.endpointsById.get(id)?.entity.groupId;
		let context = '~root';
		if (groupId !== undefined) context = defined(hierarchy?.rootById.get(groupId));
		contexts.add(context);
	}
	return [...contexts].sort(compareCanonicalStrings).join('|');
}

function packingOrder(
	components: readonly RankedComponent[],
	hierarchy: GroupHierarchy,
): readonly string[] {
	const ids = new Set<string>();
	for (const component of components) {
		for (const row of component.rows.ordinary) for (const id of row) ids.add(id);
		for (const row of component.rows.junction) for (const id of row) ids.add(id);
	}
	for (const group of hierarchy.deepestFirst) ids.add(group.id);
	return [...ids];
}

export function prepareLayout(graph: LogicGraph, ranks: TopologicalRanks): LayoutStructure {
	const hierarchy = prepareGroupHierarchy(graph.document);
	const maximumRank = Math.max(0, ...ranks.byEndpointId.values());
	const junctionIds = new Set(graph.document.junctions.map(({ id }) => id));
	const junctions = prepareJunctions(graph, ranks.byEndpointId);
	const placementRanks = new Map(ranks.byEndpointId);
	for (const [id, junction] of junctions) placementRanks.set(id, junction.interval);
	const endpointOrder = orderEndpoints([
		...graph.document.groups,
		...graph.document.nodes,
		...graph.document.junctions,
	]);
	const orderById = new Map(endpointOrder.map((id, index) => [id, index]));
	// A target-local order edit can still move a whole disconnected component. Preserving
	// this policy leaves stable component intent to a separate behavioral change.
	const blocks = groupBlocks(graph);
	const components = rankedComponents(graph, blocks).map((ids): RankedComponent => ({
		ids,
		context: componentContext(graph, ids, hierarchy),
		effectiveOrder: Math.min(
			...ids
				.filter((id) => ranks.byEndpointId.get(id) === 0)
				.map((id) => defined(orderById.get(id))),
		),
		rows: preparePlacementRows({
			ids,
			orderById,
			ranks: placementRanks,
			junctionIds,
			maximumRank,
			blocks,
		}),
	}));
	components.sort(
		(left, right) =>
			compareCanonicalStrings(left.context, right.context) ||
			left.effectiveOrder - right.effectiveOrder,
	);

	let containment: LayoutStructure['containment'];
	if (hierarchy !== undefined)
		containment = containmentComponents(graph, packingOrder(components, hierarchy));
	return {
		graph,
		ranks,
		maximumRank,
		junctionIds,
		junctions,
		hierarchy,
		components,
		containment,
		branchAnchors: branchAnchors(graph, ranks.byEndpointId),
	};
}
