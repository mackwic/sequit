export interface CanvasPoint {
	readonly x: number;
	readonly y: number;
}

export interface CanvasSize {
	readonly width: number;
	readonly height: number;
}

export interface CanvasScrollPosition {
	readonly left: number;
	readonly top: number;
}

/** A rectangle in client coordinates, as `getBoundingClientRect` gives it. */
export interface CanvasRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export const DEFAULT_CANVAS_ZOOM = 1;
export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 2.5;
const CANVAS_ZOOM_STEP = 0.1;
export const CANVAS_STAGE_PADDING = 64;
const DEFAULT_STAGE_MARGIN: CanvasPoint = { x: CANVAS_STAGE_PADDING, y: CANVAS_STAGE_PADDING };

/** What the scroll position depends on: the laid-out stage, its zoom and the viewport around it. */
export interface CanvasViewportGeometry {
	readonly stage: CanvasSize;
	readonly viewport: CanvasSize;
	readonly zoom: number;
}

/**
 * The room to pan around the stage: almost a viewport on each side, so that any part of the graph
 * can be brought anywhere on screen while a sliver of the stage always stays in view.
 */
export function canvasStageMargin(viewport: CanvasSize): CanvasPoint {
	return {
		x: Math.max(CANVAS_STAGE_PADDING, viewport.width - CANVAS_STAGE_PADDING),
		y: Math.max(CANVAS_STAGE_PADDING, viewport.height - CANVAS_STAGE_PADDING),
	};
}

export function clampCanvasZoom(zoom: number): number {
	return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function stepCanvasZoom(zoom: number, direction: -1 | 1): number {
	const delta = direction * CANVAS_ZOOM_STEP;
	const scaled = (zoom + delta) * 10;
	const stepped = Math.round(scaled) / 10;
	return clampCanvasZoom(stepped);
}

export function scaledStageExtent(
	stage: CanvasSize,
	zoom: number,
	margin = DEFAULT_STAGE_MARGIN,
): CanvasSize {
	return {
		width: stage.width * zoom + margin.x * 2,
		height: stage.height * zoom + margin.y * 2,
	};
}

/** Where the stage starts, centred while it fits and `margin` away from the edges otherwise. */
export function centeredStageOrigin(
	viewport: CanvasSize,
	stage: CanvasSize,
	zoom: number,
	margin = DEFAULT_STAGE_MARGIN,
): CanvasPoint {
	return {
		x: Math.max(margin.x, (viewport.width - stage.width * zoom) / 2),
		y: Math.max(margin.y, (viewport.height - stage.height * zoom) / 2),
	};
}

/** The stage's origin inside the scrolled content, around which the pan margin lies. */
function scrolledStageOrigin({ stage, viewport, zoom }: CanvasViewportGeometry): CanvasPoint {
	return centeredStageOrigin(viewport, stage, zoom, canvasStageMargin(viewport));
}

/** The scroll position that shows the stage as it would sit without pan margin. */
function homeScroll(geometry: CanvasViewportGeometry): CanvasScrollPosition {
	const origin = scrolledStageOrigin(geometry);
	const home = centeredStageOrigin(geometry.viewport, geometry.stage, geometry.zoom);
	return { left: origin.x - home.x, top: origin.y - home.y };
}

function clampedScroll(
	geometry: CanvasViewportGeometry,
	scroll: CanvasScrollPosition,
): CanvasScrollPosition {
	const { stage, viewport, zoom } = geometry;
	const extent = scaledStageExtent(stage, zoom, canvasStageMargin(viewport));
	return {
		left: Math.min(Math.max(0, extent.width - viewport.width), Math.max(0, scroll.left)),
		top: Math.min(Math.max(0, extent.height - viewport.height), Math.max(0, scroll.top)),
	};
}

/**
 * How far the person has panned away from where the stage sits by default. Kept across layouts
 * and resizes, it lets a stage that fits stay centred, and a larger one stay put, until panned.
 */
export function canvasPanOffset(
	geometry: CanvasViewportGeometry,
	scroll: CanvasScrollPosition,
): CanvasPoint {
	const home = homeScroll(geometry);
	return { x: scroll.left - home.left, y: scroll.top - home.top };
}

export function pannedScroll(
	geometry: CanvasViewportGeometry,
	offset: CanvasPoint,
): CanvasScrollPosition {
	const home = homeScroll(geometry);
	return clampedScroll(geometry, { left: home.left + offset.x, top: home.top + offset.y });
}

/** Keeps the document point under `anchor` in place from one geometry to the next zoom. */
export function anchorPreservingScroll({
	from,
	to,
	anchor,
	scroll,
}: {
	readonly from: CanvasViewportGeometry;
	readonly to: CanvasViewportGeometry;
	readonly anchor: CanvasPoint;
	readonly scroll: CanvasScrollPosition;
}): CanvasScrollPosition {
	const fromOrigin = scrolledStageOrigin(from);
	const toOrigin = scrolledStageOrigin(to);
	const documentPoint = {
		x: (scroll.left + anchor.x - fromOrigin.x) / from.zoom,
		y: (scroll.top + anchor.y - fromOrigin.y) / from.zoom,
	};
	return clampedScroll(to, {
		left: toOrigin.x + documentPoint.x * to.zoom - anchor.x,
		top: toOrigin.y + documentPoint.y * to.zoom - anchor.y,
	});
}

export function panScrollPosition({
	startScroll,
	startPointer,
	pointer,
	maxScroll,
}: {
	readonly startScroll: CanvasScrollPosition;
	readonly startPointer: CanvasPoint;
	readonly pointer: CanvasPoint;
	readonly maxScroll: CanvasScrollPosition;
}): CanvasScrollPosition {
	return {
		left: Math.min(maxScroll.left, Math.max(0, startScroll.left - (pointer.x - startPointer.x))),
		top: Math.min(maxScroll.top, Math.max(0, startScroll.top - (pointer.y - startPointer.y))),
	};
}

/** One axis of a rectangle: where it starts and how long it is. */
interface CanvasSpan {
	readonly start: number;
	readonly size: number;
}

function revealAxis(target: CanvasSpan, view: CanvasSpan, margin: number): number {
	const first = view.start + margin;
	const last = view.start + view.size - margin;
	const end = target.start + target.size;
	if (target.start >= first && end <= last) return 0;
	if (target.size > last - first) return target.start - first;
	const targetCentre = (target.start + end) / 2;
	const viewCentre = (first + last) / 2;
	return targetCentre - viewCentre;
}

/**
 * How far to scroll so that the target shows whole, `margin` inside the viewport: nothing along an
 * axis where it already does, otherwise it is centred, or aligned on its start when too large.
 */
export function revealScrollDelta(
	viewport: CanvasRect,
	target: CanvasRect,
	margin: number,
): CanvasPoint {
	return {
		x: revealAxis(
			{ start: target.left, size: target.width },
			{ start: viewport.left, size: viewport.width },
			margin,
		),
		y: revealAxis(
			{ start: target.top, size: target.height },
			{ start: viewport.top, size: viewport.height },
			margin,
		),
	};
}
