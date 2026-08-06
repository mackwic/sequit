import type { JunctionOperator, LogicDocument } from '../document/logic-document';
import type { Bounds, LayoutResult, Point } from '../layout/layout-graph';

interface CanvasNature {
	readonly id: string;
	readonly label: string;
	readonly color: string;
}

export interface UnpositionedCanvasNode {
	readonly id: string;
	readonly nature: CanvasNature;
	readonly markdown: string;
}

interface UnpositionedCanvasGroup {
	readonly id: string;
	readonly label: string;
}

interface UnpositionedCanvasJunction {
	readonly id: string;
	readonly operator: JunctionOperator;
}

export interface CanvasMeasurementModel {
	readonly nodes: readonly UnpositionedCanvasNode[];
	readonly groups: readonly UnpositionedCanvasGroup[];
	readonly junctions: readonly UnpositionedCanvasJunction[];
}

export interface RenderedCanvasNode extends UnpositionedCanvasNode {
	readonly bounds: Bounds;
}

interface RenderedCanvasGroup extends UnpositionedCanvasGroup {
	readonly bounds: Bounds;
}

interface RenderedCanvasJunction extends UnpositionedCanvasJunction {
	readonly bounds: Bounds;
}

interface RenderedCanvasRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly points: readonly Point[];
}

export interface CanvasModel {
	readonly width: number;
	readonly height: number;
	readonly nodes: readonly RenderedCanvasNode[];
	readonly groups: readonly RenderedCanvasGroup[];
	readonly junctions: readonly RenderedCanvasJunction[];
	readonly relations: readonly RenderedCanvasRelation[];
}

export function createCanvasMeasurementModel(document: LogicDocument): CanvasMeasurementModel {
	const natures = new Map(document.natures.map((nature) => [nature.id, nature]));
	return {
		nodes: document.nodes.map((node) => {
			const nature = natures.get(node.natureId);
			if (!nature) throw new Error(`Missing nature: ${node.natureId}`);
			return {
				id: node.id,
				nature: { id: nature.id, label: nature.label, color: nature.color },
				markdown: node.markdown,
			};
		}),
		groups: document.groups.map(({ id, label }) => ({ id, label })),
		junctions: document.junctions.map(({ id, operator }) => ({ id, operator })),
	};
}

export function createCanvasModel(
	measurement: CanvasMeasurementModel,
	layout: LayoutResult,
): CanvasModel {
	const bounds = new Map(layout.elements.map((element) => [element.id, element.bounds]));
	function boundsFor(id: string): Bounds {
		const value = bounds.get(id);
		if (!value) throw new Error(`Missing layout bounds: ${id}`);
		return value;
	}

	return {
		width: layout.width,
		height: layout.height,
		nodes: measurement.nodes.map((node) => ({ ...node, bounds: boundsFor(node.id) })),
		groups: measurement.groups.map((group) => ({ ...group, bounds: boundsFor(group.id) })),
		junctions: measurement.junctions.map((junction) => ({
			...junction,
			bounds: boundsFor(junction.id),
		})),
		relations: layout.relations.map(({ id, from, to, points }) => ({ id, from, to, points })),
	};
}
