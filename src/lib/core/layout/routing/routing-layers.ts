import { defined, EndpointKind, type LogicRelation } from '../../document/logic-document';
import type { LogicGraph } from '../../graph/create-graph';
import {
	type LayoutFrame,
	mainSize,
	transverseCenter,
	transverseSize,
	transverseStart,
} from '../geometry/layout-frame';
import { RAIL_SPACING } from '../layout-settings';
import type { Bounds } from '../layout-types';
import type { RoutingLayers } from '../layout-types';
import { layerPassages } from './layer-passages';

export interface LayerLink {
	readonly relation: LogicRelation;
	readonly sourceLayer: number;
	readonly targetLayer: number;
	readonly passage: number | undefined;
}

/**
 * Boxes that bound the outer columns of a component routed apart from its neighbours: its own
 * endpoints and the frames enclosing them. Undefined when the whole document is routed together.
 */
function exteriorIds(
	graph: LogicGraph,
	layers: RoutingLayers,
	owners: ReadonlyMap<string, number> | undefined,
): ReadonlySet<string> | undefined {
	if (owners === undefined) return undefined;
	const routedOwners = new Set<number>();
	for (const id of layers.byId.keys()) {
		const owner = owners.get(id);
		if (owner !== undefined) routedOwners.add(owner);
	}
	let apart = false;
	for (const owner of owners.values()) {
		if (routedOwners.has(owner)) continue;
		apart = true;
		break;
	}
	if (!apart) return undefined;
	const ids = new Set(layers.byId.keys());
	for (const id of layers.byId.keys()) {
		let parent = graph.endpointsById.get(id)?.entity.groupId;
		while (parent !== undefined && !ids.has(parent)) {
			ids.add(parent);
			parent = graph.endpointsById.get(parent)?.entity.groupId;
		}
	}
	return ids;
}

/** A neighbour's extent never pushes the outer columns of a component routed apart. */
function exteriorEdge(
	bounds: ReadonlyMap<string, Bounds>,
	vertical: boolean,
	ids: ReadonlySet<string> | undefined,
): number {
	let edge = Number.NEGATIVE_INFINITY;
	for (const [id, box] of bounds) {
		if (ids !== undefined && !ids.has(id)) continue;
		const end = transverseStart(box, vertical) + transverseSize(box, vertical);
		edge = Math.max(edge, end);
	}
	return edge;
}

/** Long relations use an outside column, or a validated straight passage relative to their source. */
export function layerLinks(
	graph: LogicGraph,
	layers: RoutingLayers,
	bounds: ReadonlyMap<string, Bounds>,
	{
		vertical,
		componentByEndpointId,
		sourceOffsets,
		targetOffsets,
	}: {
		readonly vertical: boolean;
		readonly componentByEndpointId?: ReadonlyMap<string, number> | undefined;
		readonly sourceOffsets?: ReadonlyMap<string, number> | undefined;
		readonly targetOffsets?: ReadonlyMap<string, number> | undefined;
	},
): readonly LayerLink[] {
	const exterior = exteriorIds(graph, layers, componentByEndpointId);
	let outside = exteriorEdge(bounds, vertical, exterior);
	const arrivals = new Map<string, number>();
	const reserve = layerPassages({
		graph,
		layers,
		bounds,
		vertical,
		componentByEndpointId,
		sourceOffsets,
		targetOffsets,
	});
	const links = graph.relations
		.filter(({ relation, source, target }) => {
			if (source.kind !== EndpointKind.Group && target.kind !== EndpointKind.Group) return true;
			return defined(layers.byId.get(relation.from)) > defined(layers.byId.get(relation.to));
		})
		.map(({ relation, target }) => ({
			relation,
			target,
			sourceLayer: defined(layers.byId.get(relation.from)),
			targetLayer: defined(layers.byId.get(relation.to)),
		}));
	const passages = new Map<LogicRelation, number>();
	// Nested spans stay nested: a shorter relation takes the nearer passage before a longer one.
	const long = links
		.filter(({ sourceLayer, targetLayer }) => sourceLayer > targetLayer + 1)
		.toSorted(
			(left, right) =>
				left.sourceLayer - left.targetLayer - (right.sourceLayer - right.targetLayer),
		);
	for (const { relation, target } of long) {
		let passage = reserve(relation) ?? arrivals.get(relation.to);
		if (passage === undefined) {
			passage = reserve.outer(relation, outside + RAIL_SPACING);
			outside = passage;
		}
		if (target.kind === EndpointKind.Junction) arrivals.set(relation.to, passage);
		passages.set(relation, passage);
	}
	return links.map(({ relation, sourceLayer, targetLayer }) => ({
		relation,
		sourceLayer,
		targetLayer,
		passage: passages.get(relation),
	}));
}

export function layerExtent(
	row: readonly string[],
	bounds: ReadonlyMap<string, Bounds>,
	frame: LayoutFrame,
): { start: number; end: number } {
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const id of row) {
		const box = defined(bounds.get(id));
		let primary = box.x;
		if (frame.vertical) primary = box.y;
		let last = primary + mainSize(box, frame.vertical);
		if (!frame.forward) [primary, last] = [-last, -primary];
		start = Math.min(start, primary);
		end = Math.max(end, last);
	}
	return { start, end };
}

export function linkCoordinate(
	link: LayerLink,
	source: boolean,
	layer: number,
	input: {
		readonly bounds: ReadonlyMap<string, Bounds>;
		readonly offsets: ReadonlyMap<string, number>;
		readonly vertical: boolean;
	},
): number {
	let endpoint = link.relation.to;
	let endpointLayer = link.targetLayer;
	if (source) {
		endpoint = link.relation.from;
		endpointLayer = link.sourceLayer;
	}
	if (layer !== endpointLayer) return defined(link.passage);
	return (
		transverseCenter(defined(input.bounds.get(endpoint)), input.vertical) +
		(input.offsets.get(link.relation.id) ?? 0)
	);
}
