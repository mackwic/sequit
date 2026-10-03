import { compareCanonicalStrings } from '../../../../lib/core/canonical-string';
import type {
	RenderedLayout,
	ReportedBounds,
	ReportedBox,
	ReportedLayout,
	ReportedMeasurements,
} from '../../../../lib/infrastructure/layout-report/layout-report';
import type { Bounds, LayoutMeasurements, Point, Size } from '../../projection/layout-graph';
import type { CanvasModel } from '../canvas/canvas-model';

export type Rename = (id: string) => string;

/**
 * Known identifiers take their anonymous token. Anything else, which the document did not
 * define, takes `x0`, `x1`… in order of first appearance, so that nothing original leaves.
 */
export function createRename(known: ReadonlyMap<string, string>): Rename {
	const others = new Map<string, string>();
	return (id) => {
		const token = known.get(id) ?? others.get(id);
		if (token !== undefined) return token;
		const next = `x${others.size}`;
		others.set(id, next);
		return next;
	};
}

function byId<T>(items: ReadonlyMap<string, T>, rename: Rename): readonly (readonly [string, T])[] {
	const renamed = [...items].map(([id, value]) => [rename(id), value] as const);
	return renamed.sort(([left], [right]) => compareCanonicalStrings(left, right));
}

export function reportedMeasurements(
	measurements: LayoutMeasurements,
	rename: Rename,
): ReportedMeasurements {
	return {
		nodes: byId(measurements.nodes, rename),
		junctions: byId(measurements.junctions, rename),
		groups: byId(measurements.groups, rename),
	};
}

function boxes(
	items: readonly { readonly id: string; readonly bounds: Bounds }[],
	rename: Rename,
): readonly ReportedBox[] {
	return items.map(({ id, bounds }) => ({ id: rename(id), bounds }));
}

/** The geometry of a canvas, without its texts, under anonymous identifiers. */
export function reportedLayout(canvas: CanvasModel, rename: Rename): ReportedLayout {
	return {
		width: canvas.width,
		height: canvas.height,
		nodes: boxes(canvas.nodes, rename),
		groups: boxes(canvas.groups, rename),
		junctions: boxes(canvas.junctions, rename),
		relations: canvas.relations.map(({ id, from, to, points }) => ({
			id: rename(id),
			from: rename(from),
			to: rename(to),
			points,
		})),
		lanes: (canvas.lanes ?? []).map(({ id, bounds, regionId }) => {
			const lane = { id: rename(id), bounds };
			if (regionId === undefined) return lane;
			return { ...lane, regionId: rename(regionId) };
		}),
		regions: boxes(canvas.regions ?? [], rename),
	};
}

function sameBoxes(
	left: readonly { readonly id: string; readonly bounds: Bounds }[],
	right: readonly { readonly id: string; readonly bounds: Bounds }[],
): boolean {
	if (left.length !== right.length) return false;
	return left.every((box, index) => {
		const other = right[index];
		if (other?.id !== box.id) return false;
		const { x, y, width, height } = other.bounds;
		const placed = box.bounds.x === x && box.bounds.y === y;
		const sized = box.bounds.width === width && box.bounds.height === height;
		return placed && sized;
	});
}

function samePoints(left: readonly Point[], right: readonly Point[]): boolean {
	if (left.length !== right.length) return false;
	return left.every(({ x, y }, index) => right[index]?.x === x && right[index].y === y);
}

/**
 * Whether two canvases place the same entities identically and route the same relations along
 * the same points. Compared in place: it runs on every accepted layout.
 */
export function sameCanvasGeometry(left: CanvasModel, right: CanvasModel): boolean {
	if (left.width !== right.width || left.height !== right.height) return false;
	if (!sameBoxes(left.nodes, right.nodes) || !sameBoxes(left.groups, right.groups)) return false;
	if (!sameBoxes(left.junctions, right.junctions)) return false;
	if (left.relations.length !== right.relations.length) return false;
	return left.relations.every((relation, index) => {
		const other = right.relations[index];
		return other?.id === relation.id && samePoints(relation.points, other.points);
	});
}

interface StageFrame {
	readonly left: number;
	readonly top: number;
	readonly zoom: number;
}

function renderedBoxes(
	stage: HTMLElement,
	attribute: string,
	frame: StageFrame,
	rename: Rename,
): readonly ReportedBox[] {
	return [...stage.querySelectorAll(`[${attribute}]`)].flatMap((element) => {
		const id = element.getAttribute(attribute);
		if (id === null || id === '') return [];
		const rect = element.getBoundingClientRect();
		const bounds = {
			x: (rect.left - frame.left) / frame.zoom,
			y: (rect.top - frame.top) / frame.zoom,
			width: rect.width / frame.zoom,
			height: rect.height / frame.zoom,
		};
		return [{ id: rename(id), bounds }];
	});
}

/** The part of the canvas inside the viewport, in canvas coordinates. */
function visibleArea(viewport: HTMLElement, frame: StageFrame, extent: Size): ReportedBounds {
	const shown = viewport.getBoundingClientRect();
	const left = Math.max(0, (shown.left - frame.left) / frame.zoom);
	const top = Math.max(0, (shown.top - frame.top) / frame.zoom);
	const right = Math.min(extent.width, (shown.right - frame.left) / frame.zoom);
	const bottom = Math.min(extent.height, (shown.bottom - frame.top) / frame.zoom);
	return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Reads back what the page drew: entity boxes from their elements and routes from their SVG
 * paths, brought to canvas coordinates. `undefined` while no canvas is drawn.
 */
export function readRenderedLayout(
	viewport: HTMLElement,
	rename: Rename,
): RenderedLayout | undefined {
	const stage = viewport.querySelector<HTMLElement>('[data-graph-stage]');
	if (stage === null) return undefined;
	const width = Number(stage.dataset['stageWidth']);
	const height = Number(stage.dataset['stageHeight']);
	const rect = stage.getBoundingClientRect();
	if (!(width > 0)) return undefined;
	if (!(rect.width > 0)) return undefined;
	const frame = { left: rect.left, top: rect.top, zoom: rect.width / width };
	return {
		width,
		height,
		zoom: frame.zoom,
		nodes: renderedBoxes(stage, 'data-node-id', frame, rename),
		groups: renderedBoxes(stage, 'data-group-id', frame, rename),
		junctions: renderedBoxes(stage, 'data-junction-id', frame, rename),
		relations: [...stage.querySelectorAll('path[data-rendered-relation-id]')].map((path) => ({
			id: rename(path.getAttribute('data-rendered-relation-id') ?? ''),
			path: path.getAttribute('d') ?? '',
		})),
		visible: visibleArea(viewport, frame, { width, height }),
	};
}
