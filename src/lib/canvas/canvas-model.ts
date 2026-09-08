import type {
	ContentStyle,
	JunctionOperator,
	LayoutDirection,
	LogicDocument,
	OrderKey,
} from '../document/logic-document';
import { contentStyleFields } from '../document/logic-document';
import type { Bounds, LayoutResult, Point } from '../layout/layout-graph';

interface CanvasNature extends ContentStyle {
	readonly id: string;
	readonly label: string;
	readonly color: string;
}

export interface UnpositionedCanvasNode extends ContentStyle {
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
	readonly navigation?: {
		readonly groupId?: string;
		readonly layoutOrder: OrderKey;
		readonly rank: number;
	};
}

export interface RenderedCanvasGroup extends UnpositionedCanvasGroup {
	readonly bounds: Bounds;
	readonly navigation?: {
		readonly groupId?: string;
		readonly layoutOrder: OrderKey;
	};
}

export interface RenderedCanvasJunction extends UnpositionedCanvasJunction {
	readonly bounds: Bounds;
}

export interface RenderedCanvasRelation {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly points: readonly Point[];
}

export interface CanvasModel {
	readonly width: number;
	readonly height: number;
	readonly direction?: LayoutDirection;
	readonly nodes: readonly RenderedCanvasNode[];
	readonly groups: readonly RenderedCanvasGroup[];
	readonly junctions: readonly RenderedCanvasJunction[];
	readonly relations: readonly RenderedCanvasRelation[];
}

export interface CanvasNavigationProjection {
	readonly document: LogicDocument;
	readonly ranks: {
		readonly byEndpointId: ReadonlyMap<string, number>;
	};
}

export function createCanvasMeasurementModel(document: LogicDocument): CanvasMeasurementModel {
	const natures = new Map(document.natures.map((nature) => [nature.id, nature]));
	return {
		nodes: document.nodes.map((node) => {
			const nature = natures.get(node.natureId);
			if (!nature) throw new Error(`Missing nature: ${node.natureId}`);
			return {
				id: node.id,
				nature,
				...contentStyleFields(node.color, node.icon),
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
	navigation?: CanvasNavigationProjection,
): CanvasModel {
	const bounds = new Map(layout.elements.map((element) => [element.id, element.bounds]));
	const nodes = new Map(navigation?.document.nodes.map((node) => [node.id, node]));
	const groups = new Map(navigation?.document.groups.map((group) => [group.id, group]));
	function boundsFor(id: string): Bounds {
		const value = bounds.get(id);
		if (!value) throw new Error(`Missing layout bounds: ${id}`);
		return value;
	}

	const direction = navigation?.document.layout.direction;
	let directionProjection: { readonly direction?: LayoutDirection } = {};
	if (direction !== undefined) directionProjection = { direction };
	return {
		width: layout.width,
		height: layout.height,
		...directionProjection,
		nodes: measurement.nodes.map((node) => {
			const semanticNode = nodes.get(node.id);
			const rank = navigation?.ranks.byEndpointId.get(node.id);
			const renderedNode: RenderedCanvasNode = {
				...node,
				bounds: boundsFor(node.id),
			};
			if (semanticNode === undefined || rank === undefined) return renderedNode;
			const nodeNavigation = { layoutOrder: semanticNode.layoutOrder, rank };
			if (semanticNode.groupId === undefined) {
				return { ...renderedNode, navigation: nodeNavigation };
			}
			return {
				...renderedNode,
				navigation: { ...nodeNavigation, groupId: semanticNode.groupId },
			};
		}),
		groups: measurement.groups.map((group) => {
			const semanticGroup = groups.get(group.id);
			const renderedGroup: RenderedCanvasGroup = {
				...group,
				bounds: boundsFor(group.id),
			};
			if (semanticGroup === undefined) return renderedGroup;
			const groupNavigation = { layoutOrder: semanticGroup.layoutOrder };
			if (semanticGroup.groupId === undefined) {
				return { ...renderedGroup, navigation: groupNavigation };
			}
			return {
				...renderedGroup,
				navigation: { ...groupNavigation, groupId: semanticGroup.groupId },
			};
		}),
		junctions: measurement.junctions.map((junction) => ({
			...junction,
			bounds: boundsFor(junction.id),
		})),
		relations: layout.relations.map(({ id, from, to, points }) => ({ id, from, to, points })),
	};
}
