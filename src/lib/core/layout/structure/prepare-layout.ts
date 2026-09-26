import { compareCanonicalStrings } from '../../canonical-string';
import { defined } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import type { TopologicalRanks } from '../../graph/topological-ranks';
import { orderEndpoints } from '../../ordering/endpoint-order';
import { type BranchAnchor, branchAnchors } from './branch-anchors';
import { type GroupHierarchy, prepareGroupHierarchy } from './group-hierarchy';
import { type JunctionPlacement, prepareJunctions } from './junction-structure';
import { containmentComponents, weaklyConnectedComponents } from './layout-components';
import { preparePlacementRows, type RankedComponent } from './placement-rows';

interface RankOrderDomain {
	readonly bands: readonly (readonly string[])[];
}

function sameOrder(
	left: readonly (readonly string[])[],
	right: readonly (readonly string[])[],
): boolean {
	if (left.length !== right.length) return false;
	for (const [index, band] of left.entries()) {
		const other = right[index];
		if (other?.length !== band.length) return false;
		for (const [position, id] of band.entries()) {
			if (other[position] !== id) return false;
		}
	}
	return true;
}

function validOrder(domain: RankOrderDomain, order: readonly (readonly string[])[]): boolean {
	if (domain.bands.length !== order.length) return false;
	for (const [index, band] of order.entries()) {
		const expected = domain.bands[index];
		if (expected?.length !== band.length) return false;
		const remaining = new Set(expected);
		for (const id of band) {
			if (!remaining.delete(id)) return false;
		}
		if (remaining.size !== 0) return false;
	}
	return true;
}

export interface LayoutStructure {
	readonly graph: LogicGraph;
	readonly ranks: TopologicalRanks;
	readonly maximumRank: number;
	readonly junctionIds: ReadonlySet<string>;
	readonly junctions: ReadonlyMap<string, JunctionPlacement>;
	readonly branchAnchors: ReadonlyMap<string, BranchAnchor>;
	readonly hierarchy: GroupHierarchy | undefined;
	readonly components: readonly RankedComponent[];
	readonly rankOrderDomain: RankOrderDomain;
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

export function prepareLayout(
	graph: LogicGraph,
	ranks: TopologicalRanks,
	order?: readonly (readonly string[])[],
): LayoutStructure {
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
	let components = weaklyConnectedComponents(graph).map((ids): RankedComponent => ({
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
		}),
	}));
	components.sort(
		(left, right) =>
			compareCanonicalStrings(left.context, right.context) ||
			left.effectiveOrder - right.effectiveOrder,
	);
	const rankOrderDomain: RankOrderDomain = {
		bands: components.flatMap((component) => component.rows.ordinary),
	};
	const effectiveOrder = order ?? rankOrderDomain.bands;
	if (!validOrder(rankOrderDomain, effectiveOrder))
		throw new Error('Invalid ordinary-row rank order');
	if (!sameOrder(rankOrderDomain.bands, effectiveOrder)) {
		let bandIndex = 0;
		components = components.map((component) => {
			const bandCount = component.rows.ordinary.length;
			const ordinaryOrder = effectiveOrder.slice(bandIndex, bandIndex + bandCount).flat();
			bandIndex += bandCount;
			return {
				...component,
				rows: preparePlacementRows({
					ids: component.ids,
					orderById,
					ranks: placementRanks,
					junctionIds,
					maximumRank,
					ordinaryOrder,
				}),
			};
		});
	}
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
		rankOrderDomain,
		containment,
		branchAnchors: branchAnchors(graph, ranks.byEndpointId),
	};
}
