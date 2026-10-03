import type { LogicDocument } from '../../../../lib/core/document/logic-document';
import type { Bounds } from '../../projection/layout-graph';
import type { CanvasModel, RenderedCanvasNode } from '../canvas/canvas-model';
import { bodyMarkdown } from '../content/body-markdown';
import {
	arrow,
	type BoundElement,
	elementId,
	ElementType,
	type ExcalidrawElement,
	GROUP_INK,
	groupIdsFor,
	INK,
	inset,
	JUNCTION_FILL,
	labelBounds,
	LANE_INK,
	REGION_INK,
	shape,
	StrokeStyle,
	textElement,
} from './excalidraw-elements';

function boundArrowsFor(
	canvas: CanvasModel,
	endpointBounds: ReadonlyMap<string, Bounds>,
): ReadonlyMap<string, readonly BoundElement[]> {
	const boundArrows = new Map<string, BoundElement[]>();
	for (const relation of canvas.relations) {
		for (const endpoint of new Set([relation.from, relation.to])) {
			if (!endpointBounds.has(endpoint)) continue;
			const references = boundArrows.get(endpoint) ?? [];
			references.push({ id: elementId('relation', relation.id), type: ElementType.Arrow });
			boundArrows.set(endpoint, references);
		}
	}
	return boundArrows;
}

function hexChannels(color: string): readonly [number, number, number] | undefined {
	const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
	let digits = match?.[1];
	if (digits === undefined) return undefined;
	if (digits.length === 3) digits = digits.replace(/./g, (digit) => digit.repeat(2));
	return [
		Number.parseInt(digits.slice(0, 2), 16),
		Number.parseInt(digits.slice(2, 4), 16),
		Number.parseInt(digits.slice(4, 6), 16),
	];
}

function mixChannel(foreground: number, background: number, ratio: number): string {
	const inverse = 1 - ratio;
	const mixed = Math.round(foreground * ratio + background * inverse);
	return mixed.toString(16).padStart(2, '0');
}

/** The canvas uses the same sRGB mix for its colored border and header. */
function mixedColor(color: string, background: string, ratio: number): string {
	const foreground = hexChannels(color);
	const base = hexChannels(background);
	if (foreground === undefined || base === undefined) return color;
	const [red, green, blue] = foreground;
	const [baseRed, baseGreen, baseBlue] = base;
	return `#${mixChannel(red, baseRed, ratio)}${mixChannel(green, baseGreen, ratio)}${mixChannel(blue, baseBlue, ratio)}`;
}

function nodeElements(
	node: RenderedCanvasNode,
	parentGroups: readonly string[],
	boundElements: readonly BoundElement[] | undefined,
): readonly ExcalidrawElement[] {
	const groupIds = [elementId('node-group', node.id), ...parentGroups];
	const color = node.color ?? node.nature.color;
	const headerColor = mixedColor(color, '#ffffff', 0.13);
	const borderColor = mixedColor(color, '#d6d3d1', 0.35);
	const headerBounds = {
		x: node.bounds.x + 1,
		y: node.bounds.y + 1,
		width: Math.max(1, node.bounds.width - 2),
		height: Math.min(32, Math.max(1, node.bounds.height - 2)),
	};
	const headerBottom = {
		...headerBounds,
		y: headerBounds.y + headerBounds.height / 2,
		height: headerBounds.height / 2,
	};
	const elements: ExcalidrawElement[] = [
		shape(ElementType.Rectangle, {
			id: elementId('endpoint', node.id),
			bounds: node.bounds,
			groupIds,
			style: { strokeColor: borderColor, backgroundColor: '#ffffff' },
			boundElements,
		}),
		shape(ElementType.Rectangle, {
			id: elementId('node-header', node.id),
			bounds: headerBounds,
			groupIds,
			style: { strokeColor: 'transparent', backgroundColor: headerColor },
		}),
		shape(ElementType.Rectangle, {
			id: elementId('node-header-bottom', node.id),
			bounds: headerBottom,
			groupIds,
			style: { strokeColor: 'transparent', backgroundColor: headerColor, rounded: false },
		}),
		textElement({
			id: elementId('node-nature', node.id),
			value: node.nature.label,
			bounds: labelBounds(node.bounds, { left: 12, top: 7, right: 12, height: 15 }),
			groupIds,
			fontSize: 11,
			color: INK,
		}),
	];
	const body = bodyMarkdown(node.markdown)
		.map(({ text }) => text)
		.join('');
	if (body.length > 0)
		elements.push(
			textElement({
				id: elementId('node-body', node.id),
				value: body,
				bounds: inset(node.bounds, { left: 12, top: 38, right: 12, bottom: 12 }),
				groupIds,
				fontSize: 14,
				color: INK,
			}),
		);
	return elements;
}

/** A native editable Excalidraw scene using the current projected Sequit geometry. */
export function serializeExcalidraw(document: LogicDocument, canvas: CanvasModel): string {
	const parents = new Map(document.groups.map(({ id, groupId }) => [id, groupId]));
	const nodeParents = new Map(document.nodes.map(({ id, groupId }) => [id, groupId]));
	const junctionParents = new Map(document.junctions.map(({ id, groupId }) => [id, groupId]));
	const endpointBounds = new Map(
		[...canvas.groups, ...canvas.nodes, ...canvas.junctions].map(({ id, bounds }) => [id, bounds]),
	);
	const endpointGroups = new Map<string, readonly string[]>([
		...canvas.groups.map(({ id }) => [id, groupIdsFor(id, parents)] as const),
		...canvas.nodes.map(({ id }) => [id, groupIdsFor(nodeParents.get(id), parents)] as const),
		...canvas.junctions.map(
			({ id }) => [id, groupIdsFor(junctionParents.get(id), parents)] as const,
		),
	]);
	const boundArrows = boundArrowsFor(canvas, endpointBounds);
	const elements: ExcalidrawElement[] = [];
	for (const region of canvas.regions ?? []) {
		const ids = [elementId('region-group', region.id)];
		elements.push(
			shape(ElementType.Rectangle, {
				id: elementId('region', region.id),
				bounds: region.bounds,
				groupIds: ids,
				style: { strokeColor: REGION_INK },
			}),
			textElement({
				id: elementId('region-label', region.id),
				value: region.label,
				bounds: labelBounds(region.bounds, { left: 12, top: 4, right: 12, height: 18 }),
				groupIds: ids,
				fontSize: 12,
				color: '#475569',
			}),
		);
	}
	for (const lane of canvas.lanes ?? []) {
		const ids = [elementId('lane-group', lane.regionId ?? '', lane.id)];
		elements.push(
			shape(ElementType.Rectangle, {
				id: elementId('lane', lane.regionId ?? '', lane.id),
				bounds: lane.bounds,
				groupIds: ids,
				style: { strokeColor: LANE_INK, strokeStyle: StrokeStyle.Dashed },
			}),
			textElement({
				id: elementId('lane-label', lane.regionId ?? '', lane.id),
				value: lane.label,
				bounds: labelBounds(lane.bounds, { left: 12, top: 4, right: 12, height: 18 }),
				groupIds: ids,
				fontSize: 12,
				color: '#64748b',
			}),
		);
	}
	for (const group of [...canvas.groups].sort((a, b) => {
		const depth = groupIdsFor(a.id, parents).length - groupIdsFor(b.id, parents).length;
		if (depth !== 0) return depth;
		return Number(a.id > b.id) - Number(a.id < b.id);
	})) {
		const ids = groupIdsFor(group.id, parents);
		elements.push(
			shape(ElementType.Rectangle, {
				id: elementId('endpoint', group.id),
				bounds: group.bounds,
				groupIds: ids,
				style: { strokeColor: group.color ?? GROUP_INK },
				boundElements: boundArrows.get(group.id),
			}),
			textElement({
				id: elementId('group-label', group.id),
				value: group.label,
				bounds: labelBounds(group.bounds, { left: 14, top: 8, right: 14, height: 18 }),
				groupIds: ids,
				fontSize: 12,
				color: INK,
			}),
		);
	}
	for (const relation of canvas.relations)
		elements.push(arrow(relation, endpointBounds, endpointGroups));
	for (const node of canvas.nodes)
		elements.push(
			...nodeElements(
				node,
				groupIdsFor(nodeParents.get(node.id), parents),
				boundArrows.get(node.id),
			),
		);
	for (const junction of canvas.junctions) {
		const ids = [
			elementId('junction-group', junction.id),
			...groupIdsFor(junctionParents.get(junction.id), parents),
		];
		elements.push(
			shape(ElementType.Ellipse, {
				id: elementId('endpoint', junction.id),
				bounds: junction.bounds,
				groupIds: ids,
				style: { strokeColor: '#57534e', backgroundColor: JUNCTION_FILL },
				boundElements: boundArrows.get(junction.id),
			}),
			textElement({
				id: elementId('junction-label', junction.id),
				value: junction.operator.toUpperCase(),
				bounds: junction.bounds,
				groupIds: ids,
				fontSize: 8,
				color: INK,
				centered: true,
			}),
		);
	}
	return JSON.stringify(
		{
			type: 'excalidraw',
			version: 2,
			source: 'https://excalidraw.com',
			elements,
			appState: { name: document.title, viewBackgroundColor: '#ffffff', gridSize: null },
			files: {},
		},
		null,
		2,
	);
}
