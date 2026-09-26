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
	let outside = Math.max(
		...[...bounds.values()].map(
			(box) => transverseStart(box, vertical) + transverseSize(box, vertical),
		),
	);
	const arrivals = new Map<string, number>();
	const localPassage = layerPassages({
		graph,
		layers,
		bounds,
		vertical,
		componentByEndpointId,
		sourceOffsets,
		targetOffsets,
	});
	return graph.relations
		.filter(
			({ source, target }) =>
				source.kind !== EndpointKind.Group && target.kind !== EndpointKind.Group,
		)
		.map(({ relation, target }) => {
			const sourceLayer = defined(layers.byId.get(relation.from));
			const targetLayer = defined(layers.byId.get(relation.to));
			let passage;
			if (sourceLayer > targetLayer + 1) {
				passage = localPassage(relation) ?? arrivals.get(relation.to);
				if (passage === undefined) {
					outside += RAIL_SPACING;
					passage = outside;
				}
			}
			if (passage !== undefined && target.kind === EndpointKind.Junction)
				arrivals.set(relation.to, passage);
			return { relation, sourceLayer, targetLayer, passage };
		});
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
