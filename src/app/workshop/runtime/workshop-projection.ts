import { collapsedDocument } from '../../../lib/core/document/collapsed-document';
export { collapsedDocument } from '../../../lib/core/document/collapsed-document';
import { defined, type LogicDocument } from '../../../lib/core/document/logic-document';
import { createGraph } from '../../../lib/core/graph/create-graph';
import { topologicallyRank } from '../../../lib/core/graph/topological-ranks';
import { routePoints } from '../../../lib/core/layout/routing/endpoint-routes';
import type { CanvasProjection } from '../../web/projection/canvas-projection';
import { layoutGraph, type LayoutMeasurements } from '../../web/projection/layout-graph';
import { createCanvasMeasurementModel, createCanvasModel } from '../../web/ui/canvas/canvas-model';

export function projectWorkshop(
	model: LogicDocument,
	collapsed: readonly string[],
	spacing: number,
): CanvasProjection {
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
					points: routePoints({
						source: defined(bounds.get(relation.from)),
						target: defined(bounds.get(relation.to)),
						direction: visible.layout.direction,
					}),
				})),
			};
		},
	};
}
