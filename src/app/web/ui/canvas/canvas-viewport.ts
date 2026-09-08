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

export const DEFAULT_CANVAS_ZOOM = 1;
export const MIN_CANVAS_ZOOM = 0.5;
export const MAX_CANVAS_ZOOM = 2;
const CANVAS_ZOOM_STEP = 0.1;
export const CANVAS_STAGE_PADDING = 64;

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
	padding = CANVAS_STAGE_PADDING,
): CanvasSize {
	const totalPadding = padding * 2;
	return {
		width: stage.width * zoom + totalPadding,
		height: stage.height * zoom + totalPadding,
	};
}

export function centeredStageOrigin(
	viewport: CanvasSize,
	stage: CanvasSize,
	zoom: number,
	padding = CANVAS_STAGE_PADDING,
): CanvasPoint {
	return {
		x: Math.max(padding, (viewport.width - stage.width * zoom) / 2),
		y: Math.max(padding, (viewport.height - stage.height * zoom) / 2),
	};
}

function clampScroll(value: number, extent: number, viewport: number): number {
	return Math.min(Math.max(0, extent - viewport), Math.max(0, value));
}

export function anchorPreservingScroll({
	stage,
	viewport,
	anchor,
	scroll,
	fromZoom,
	toZoom,
	padding = CANVAS_STAGE_PADDING,
}: {
	readonly stage: CanvasSize;
	readonly viewport: CanvasSize;
	readonly anchor: CanvasPoint;
	readonly scroll: CanvasScrollPosition;
	readonly fromZoom: number;
	readonly toZoom: number;
	readonly padding?: number;
}): CanvasScrollPosition {
	const fromOrigin = centeredStageOrigin(viewport, stage, fromZoom, padding);
	const toOrigin = centeredStageOrigin(viewport, stage, toZoom, padding);
	const documentPoint = {
		x: (scroll.left + anchor.x - fromOrigin.x) / fromZoom,
		y: (scroll.top + anchor.y - fromOrigin.y) / fromZoom,
	};
	const extent = scaledStageExtent(stage, toZoom, padding);
	return {
		left: clampScroll(
			toOrigin.x + documentPoint.x * toZoom - anchor.x,
			extent.width,
			viewport.width,
		),
		top: clampScroll(
			toOrigin.y + documentPoint.y * toZoom - anchor.y,
			extent.height,
			viewport.height,
		),
	};
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
