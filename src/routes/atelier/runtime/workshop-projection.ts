import {
	type CanvasMeasurementModel,
	type CanvasModel,
	createCanvasMeasurementModel,
	createCanvasModel,
} from '../../../lib/canvas/canvas-model';
import { defined, type LogicDocument } from '../../../lib/document/logic-document';
import { createGraph } from '../../../lib/graph/create-graph';
import { topologicallyRank } from '../../../lib/graph/topological-ranks';
import { routePointsWithGroupHeaders } from '../../../lib/layout/dedicated-layout-geometry';
import { layoutGraph, type LayoutMeasurements } from '../../../lib/layout/layout-graph';

/** Collapse is a view: IDs and source content remain intact in WorkshopDocument. */
export function collapsedDocument(
	model: LogicDocument,
	collapsed: readonly string[],
): LogicDocument {
	const parents = new Map(
		[...model.groups, ...model.nodes, ...model.junctions].map((item) => [item.id, item.groupId]),
	);
	function visibleId(id: string): string {
		let result = id;
		let parent = parents.get(id);
		while (parent !== undefined) {
			if (collapsed.includes(parent)) result = parent;
			parent = parents.get(parent);
		}
		return result;
	}
	const seen = new Set<string>();
	return {
		...model,
		nodes: model.nodes.filter((item) => visibleId(item.id) === item.id),
		groups: model.groups.filter((item) => visibleId(item.id) === item.id),
		junctions: model.junctions.filter((item) => visibleId(item.id) === item.id),
		relations: model.relations.flatMap((item) => {
			const from = visibleId(item.from),
				to = visibleId(item.to);
			const key = JSON.stringify([from, to]);
			if (from === to || seen.has(key)) return [];
			seen.add(key);
			return [{ ...item, from, to }];
		}),
	};
}
interface WorkshopProjection {
	readonly measurementModel: CanvasMeasurementModel;
	subscribe: () => () => void;
	createCanvasModel: (measurements: LayoutMeasurements) => Promise<CanvasModel>;
}
export function projectWorkshop(
	model: LogicDocument,
	collapsed: readonly string[],
	spacing: number,
): WorkshopProjection {
	const visible = collapsedDocument(model, collapsed);
	const graph = createGraph(visible);
	if (!graph.ok)
		throw new Error(
			'Ce repli masque un chemin qui sort puis revient dans le groupe. Dépliez-le pour conserver le sens du graphe.',
		);
	const ranks = topologicallyRank(graph.value);
	const measurementModel = createCanvasMeasurementModel(visible);
	return {
		measurementModel,
		subscribe: () => () => undefined,
		async createCanvasModel(measurements: LayoutMeasurements) {
			const inflated = {
				...measurements,
				nodes: new Map(
					[...measurements.nodes].map(([id, size]) => [
						id,
						{ width: size.width * spacing, height: size.height * spacing },
					]),
				),
			};
			const layout = await layoutGraph(graph.value, ranks, inflated);
			const projected = createCanvasModel(measurementModel, layout, { document: visible, ranks });
			if (spacing === 1) return projected;
			const nodes = projected.nodes.map((node) => ({
				...node,
				bounds: { ...node.bounds, ...defined(measurements.nodes.get(node.id)) },
			}));
			const bounds = new Map(
				[...nodes, ...projected.groups, ...projected.junctions].map((item) => [
					item.id,
					item.bounds,
				]),
			);
			return {
				...projected,
				nodes,
				relations: projected.relations.map((relation) => ({
					...relation,
					points: routePointsWithGroupHeaders({
						source: defined(bounds.get(relation.from)),
						target: defined(bounds.get(relation.to)),
						direction: visible.layout.direction,
						sourceGroup: measurements.groups.get(relation.from),
						targetGroup: measurements.groups.get(relation.to),
					}),
				})),
			};
		},
	};
}
