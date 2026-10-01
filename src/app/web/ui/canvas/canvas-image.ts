import { toSvg } from 'html-to-image';

import type { CanvasSize } from './canvas-viewport';

const STAGE_SELECTOR = '[data-graph-stage]';
const ENTITY_SELECTOR = '[data-canvas-entity-key]';
/** Breathing room around a selection, in stage pixels. */
const SELECTION_PADDING = 32;
const EXPORT_BACKGROUND = '#ffffff';
export const EXPORT_SCALES = [1, 2, 3] as const;
export type ExportScale = (typeof EXPORT_SCALES)[number];

export interface CanvasImageOptions {
	/** Keep the selected entities alone, framed with a margin; the whole stage otherwise. */
	readonly selection: ReadonlySet<string> | undefined;
	/** Paint white behind the picture; transparent otherwise. */
	readonly background: boolean;
}

export interface CanvasImage {
	/** A standalone SVG document; the picture is HTML inside a `foreignObject`. */
	readonly svg: string;
	/** Its size in CSS pixels. */
	readonly size: CanvasSize;
}

interface Frame extends CanvasSize {
	readonly x: number;
	readonly y: number;
}

/** The rendered stage under `root`; absent while the document is measured or has no layout. */
export function canvasStageElement(root: Element): HTMLElement | undefined {
	return root.querySelector<HTMLElement>(STAGE_SELECTOR) ?? undefined;
}

/** The keys of the entities currently pressed on the stage: the canvas selection as rendered. */
export function canvasSelectedKeys(stage: Element): Set<string> {
	const keys = new Set<string>();
	for (const element of stage.querySelectorAll(`${ENTITY_SELECTOR}[aria-pressed="true"]`)) {
		const key = element.getAttribute('data-canvas-entity-key');
		if (key !== null) keys.add(key);
	}
	return keys;
}

/**
 * Whether a rendered element belongs to a selection export: a chosen entity, or a relation
 * joining two chosen ends, which is part of the picture even when it was not clicked.
 */
function exported(element: Element, selection: ReadonlySet<string>): boolean {
	const key = element.getAttribute('data-canvas-entity-key');
	if (key !== null && selection.has(key)) return true;
	const relation =
		element.getAttribute('data-rendered-relation-id') ?? element.getAttribute('data-relation-id');
	if (relation === null) return false;
	if (selection.has(`relation:${relation}`)) return true;
	const ends = [element.getAttribute('data-edge-from'), element.getAttribute('data-edge-to')];
	const ids = new Set([...selection].map((entity) => entity.slice(entity.indexOf(':') + 1)));
	return ends.every((end) => end !== null && ids.has(end));
}

/** The selected entities' box in stage pixels, padded, clamped to the stage. */
function selectionFrame(stage: HTMLElement, selection: ReadonlySet<string>): Frame {
	const origin = stage.getBoundingClientRect();
	const zoom = origin.width / stage.offsetWidth;
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const element of stage.querySelectorAll(ENTITY_SELECTOR)) {
		if (!exported(element, selection)) continue;
		const box = element.getBoundingClientRect();
		left = Math.min(left, (box.left - origin.left) / zoom);
		top = Math.min(top, (box.top - origin.top) / zoom);
		right = Math.max(right, (box.right - origin.left) / zoom);
		bottom = Math.max(bottom, (box.bottom - origin.top) / zoom);
	}
	const x = Math.max(0, Math.floor(left - SELECTION_PADDING));
	const y = Math.max(0, Math.floor(top - SELECTION_PADDING));
	return {
		x,
		y,
		width: Math.min(stage.offsetWidth, Math.ceil(right + SELECTION_PADDING)) - x,
		height: Math.min(stage.offsetHeight, Math.ceil(bottom + SELECTION_PADDING)) - y,
	};
}

/**
 * Pictures the stage as an SVG at its natural size, ignoring the screen zoom and the selection marks.
 * `data-exporting` on the stage drives the styles that hide the selection while the DOM is cloned;
 * the clone reads computed styles, so motion already under way is left to settle first.
 */
export async function renderCanvasImage(
	stage: HTMLElement,
	options: CanvasImageOptions,
): Promise<CanvasImage> {
	const { selection } = options;
	const whole: Frame = { x: 0, y: 0, width: stage.offsetWidth, height: stage.offsetHeight };
	stage.setAttribute('data-exporting', '');
	try {
		await Promise.all(
			stage
				.getAnimations({ subtree: true })
				.map((animation) => animation.finished.catch(() => undefined)),
		);
		let frame = whole;
		if (selection !== undefined) frame = selectionFrame(stage, selection);
		const dataUrl = await toSvg(stage, {
			width: whole.width,
			height: whole.height,
			// The clone serialises every inset shorthand: only a value shared by all four sides holds.
			style: { transform: 'none', inset: '0px' },
			// Relations live in an inner `<svg>`, cloned whole: `frameSvg` prunes them afterwards.
			filter: (node) => {
				if (selection === undefined) return true;
				if (!(node instanceof Element)) return true;
				if (node.hasAttribute('data-lane-id')) return false;
				if (node.hasAttribute('data-region-id')) return false;
				const key = node.getAttribute('data-canvas-entity-key');
				return key === null || selection.has(key);
			},
		});
		const markup = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
		return { svg: frameSvg(markup, frame, whole, options), size: frame };
	} finally {
		stage.removeAttribute('data-exporting');
	}
}

/** Crops the full-stage SVG to `frame`, prunes relations outside the selection, paints the background. */
function frameSvg(
	markup: string,
	frame: Frame,
	whole: CanvasSize,
	options: CanvasImageOptions,
): string {
	const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
	const root = document.documentElement;
	root.setAttribute('width', String(frame.width));
	root.setAttribute('height', String(frame.height));
	root.setAttribute('viewBox', `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
	const content = root.querySelector('foreignObject');
	content?.setAttribute('width', String(whole.width));
	content?.setAttribute('height', String(whole.height));
	if (options.selection !== undefined) {
		const selection = options.selection;
		for (const path of root.querySelectorAll('[data-rendered-relation-id], [data-relation-id]'))
			if (!exported(path, selection)) path.remove();
	}
	if (options.background) {
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', String(frame.x));
		rect.setAttribute('y', String(frame.y));
		rect.setAttribute('width', String(frame.width));
		rect.setAttribute('height', String(frame.height));
		rect.setAttribute('fill', EXPORT_BACKGROUND);
		root.insertBefore(rect, root.firstChild);
	}
	return new XMLSerializer().serializeToString(root);
}

/** Rasterises a canvas image at `scale` device pixels per CSS pixel. */
export async function rasterizeCanvasImage(image: CanvasImage, scale: ExportScale): Promise<Blob> {
	const picture = new Image();
	picture.decoding = 'sync';
	picture.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`;
	await picture.decode();
	const canvas = document.createElement('canvas');
	canvas.width = image.size.width * scale;
	canvas.height = image.size.height * scale;
	const context = canvas.getContext('2d');
	if (context === null) throw new Error('The canvas could not be rendered as an image.');
	context.drawImage(picture, 0, 0, canvas.width, canvas.height);
	const { promise, resolve, reject } = Promise.withResolvers<Blob>();
	canvas.toBlob((blob) => {
		if (blob === null) reject(new Error('The canvas could not be rendered as an image.'));
		else resolve(blob);
	}, 'image/png');
	return promise;
}
