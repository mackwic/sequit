import type { Bounds, Point } from '../../projection/layout-graph';
import type { RenderedCanvasRelation } from '../canvas/canvas-model';

export enum ElementType {
	Rectangle = 'rectangle',
	Ellipse = 'ellipse',
	Text = 'text',
	Arrow = 'arrow',
}

export enum StrokeStyle {
	Solid = 'solid',
	Dashed = 'dashed',
}

enum FillStyle {
	Solid = 'solid',
}

enum TextAlign {
	Left = 'left',
	Center = 'center',
}

enum VerticalAlign {
	Top = 'top',
	Middle = 'middle',
}

enum BindingMode {
	Inside = 'inside',
}

export interface BoundElement {
	readonly id: string;
	readonly type: ElementType.Arrow;
}

interface AdaptiveRoundness {
	readonly type: 3;
}

interface ElementBase extends Bounds {
	readonly id: string;
	readonly angle: number;
	readonly strokeColor: string;
	readonly backgroundColor: string;
	readonly fillStyle: FillStyle.Solid;
	readonly strokeWidth: number;
	readonly strokeStyle: StrokeStyle;
	readonly roughness: number;
	readonly opacity: number;
	readonly roundness: null | AdaptiveRoundness;
	readonly seed: number;
	readonly version: number;
	readonly versionNonce: number;
	readonly index: null;
	readonly isDeleted: false;
	readonly groupIds: readonly string[];
	readonly frameId: null;
	readonly boundElements: readonly BoundElement[];
	readonly updated: number;
	readonly created: null;
	readonly link: null;
	readonly locked: false;
}

interface ShapeElement extends ElementBase {
	readonly type: ElementType.Rectangle | ElementType.Ellipse;
}

interface TextElement extends ElementBase {
	readonly type: ElementType.Text;
	readonly text: string;
	readonly originalText: string;
	readonly fontSize: number;
	readonly fontFamily: 2;
	readonly textAlign: TextAlign;
	readonly verticalAlign: VerticalAlign;
	readonly containerId: null;
	readonly autoResize: false;
	readonly lineHeight: 1.25;
}

interface PointBinding {
	readonly elementId: string;
	readonly fixedPoint: readonly [number, number];
	readonly mode: BindingMode.Inside;
}

interface ArrowElement extends ElementBase {
	readonly type: ElementType.Arrow;
	readonly points: readonly (readonly [number, number])[];
	readonly startBinding: PointBinding | null;
	readonly endBinding: PointBinding | null;
	readonly startArrowhead: null;
	readonly endArrowhead: ElementType.Arrow;
	readonly elbowed: false;
}

export type ExcalidrawElement = ShapeElement | TextElement | ArrowElement;

interface ElementStyle {
	readonly strokeColor?: string;
	readonly backgroundColor?: string;
	readonly strokeWidth?: number;
	readonly strokeStyle?: StrokeStyle;
	readonly rounded?: boolean;
}

export const INK = '#292524';
export const REGION_INK = '#94a3b8';
export const LANE_INK = '#cbd5e1';
export const GROUP_INK = '#78716c';
export const JUNCTION_FILL = '#facc15';

/** Namespaces make every generated element and virtual Excalidraw group unambiguous. */
export function elementId(...parts: readonly string[]): string {
	return `sequit:${JSON.stringify(parts)}`;
}

/** RoughJS seeds and version nonces are stable for repeated exports of one document. */
function seedFor(id: string): number {
	let hash = 2166136261;
	for (let index = 0; index < id.length; index += 1) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

interface ElementOptions {
	readonly id: string;
	readonly bounds: Bounds;
	readonly groupIds: readonly string[];
	readonly style?: ElementStyle;
	readonly boundElements?: readonly BoundElement[] | undefined;
}

function base({
	id,
	bounds,
	groupIds,
	style = {},
	boundElements = [],
}: ElementOptions): ElementBase {
	return {
		id,
		...bounds,
		angle: 0,
		strokeColor: style.strokeColor ?? INK,
		backgroundColor: style.backgroundColor ?? 'transparent',
		fillStyle: FillStyle.Solid,
		strokeWidth: style.strokeWidth ?? 1,
		strokeStyle: style.strokeStyle ?? StrokeStyle.Solid,
		roughness: 0,
		opacity: 100,
		roundness: null,
		seed: seedFor(id),
		version: 1,
		versionNonce: seedFor(`${id}:version`),
		index: null,
		isDeleted: false,
		groupIds,
		frameId: null,
		boundElements,
		updated: 0,
		created: null,
		link: null,
		locked: false,
	};
}

export function shape(type: ShapeElement['type'], options: ElementOptions): ShapeElement {
	const element = base(options);
	if (type === ElementType.Rectangle && options.style?.rounded !== false)
		return { ...element, type, roundness: { type: 3 } };
	return { ...element, type };
}

interface TextOptions extends ElementOptions {
	readonly value: string;
	readonly fontSize: number;
	readonly color: string;
	readonly centered?: boolean;
}

export function textElement(options: TextOptions): TextElement {
	const { id, bounds, groupIds, value, fontSize, color, centered = false } = options;
	let textAlign = TextAlign.Left;
	let verticalAlign = VerticalAlign.Top;
	if (centered) {
		textAlign = TextAlign.Center;
		verticalAlign = VerticalAlign.Middle;
	}
	return {
		...base({ id, bounds, groupIds, style: { strokeColor: color, strokeWidth: 0 } }),
		type: ElementType.Text,
		text: value,
		originalText: value,
		fontSize,
		fontFamily: 2,
		textAlign,
		verticalAlign,
		containerId: null,
		autoResize: false,
		lineHeight: 1.25,
	};
}

export function inset(
	bounds: Bounds,
	padding: { left: number; top: number; right: number; bottom: number },
): Bounds {
	const { left, top, right, bottom } = padding;
	return {
		x: bounds.x + left,
		y: bounds.y + top,
		width: Math.max(1, bounds.width - left - right),
		height: Math.max(1, bounds.height - top - bottom),
	};
}

/** Labels occupy their header line, not the full container hit area. */
export function labelBounds(
	bounds: Bounds,
	options: { left: number; top: number; right: number; height: number },
): Bounds {
	const { left, top, right, height } = options;
	return {
		x: bounds.x + left,
		y: bounds.y + top,
		width: Math.max(1, bounds.width - left - right),
		height: Math.max(1, Math.min(height, bounds.height - top)),
	};
}

export function groupIdsFor(
	groupId: string | undefined,
	parents: ReadonlyMap<string, string | undefined>,
): readonly string[] {
	const ids: string[] = [];
	const visited = new Set<string>();
	let current = groupId;
	while (current !== undefined && !visited.has(current)) {
		visited.add(current);
		ids.push(elementId('group', current));
		current = parents.get(current);
	}
	return ids;
}

function commonGroupIds(first: readonly string[], second: readonly string[]): readonly string[] {
	const other = new Set(second);
	return first.filter((id) => other.has(id));
}

function bindingFor(point: Point, endpointId: string, bounds: Bounds): PointBinding {
	const ratio = (coordinate: number, origin: number, extent: number): number => {
		if (extent <= 0) return 0.5;
		return Math.max(0, Math.min(1, (coordinate - origin) / extent));
	};
	return {
		elementId: endpointId,
		fixedPoint: [ratio(point.x, bounds.x, bounds.width), ratio(point.y, bounds.y, bounds.height)],
		mode: BindingMode.Inside,
	};
}

export function arrow(
	relation: RenderedCanvasRelation,
	endpointBounds: ReadonlyMap<string, Bounds>,
	endpointGroups: ReadonlyMap<string, readonly string[]>,
): ArrowElement {
	const first = relation.points[0];
	const last = relation.points.at(-1);
	if (relation.points.length < 2)
		throw new Error(`Missing route points for relation ${relation.id}`);
	if (first === undefined || last === undefined)
		throw new Error(`Missing route points for relation ${relation.id}`);
	const xs = relation.points.map(({ x }) => x);
	const ys = relation.points.map(({ y }) => y);
	const fromBounds = endpointBounds.get(relation.from);
	const toBounds = endpointBounds.get(relation.to);
	let startBinding: PointBinding | null = null;
	let endBinding: PointBinding | null = null;
	if (fromBounds !== undefined)
		startBinding = bindingFor(first, elementId('endpoint', relation.from), fromBounds);
	if (toBounds !== undefined)
		endBinding = bindingFor(last, elementId('endpoint', relation.to), toBounds);
	return {
		...base({
			id: elementId('relation', relation.id),
			bounds: {
				x: first.x,
				y: first.y,
				width: Math.max(...xs) - Math.min(...xs),
				height: Math.max(...ys) - Math.min(...ys),
			},
			groupIds: commonGroupIds(
				endpointGroups.get(relation.from) ?? [],
				endpointGroups.get(relation.to) ?? [],
			),
			style: { strokeColor: INK, strokeWidth: 2 },
		}),
		type: ElementType.Arrow,
		points: relation.points.map(({ x, y }) => [x - first.x, y - first.y]),
		startBinding,
		endBinding,
		startArrowhead: null,
		endArrowhead: ElementType.Arrow,
		elbowed: false,
	};
}
