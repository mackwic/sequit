import type { EntityKey } from './canvas-entity';
import type { CanvasPoint } from './canvas-viewport';

const ENTITY_SELECTOR = '[data-canvas-entity-key]';

/** The single rendered element carrying this entity key, wherever it sits in the stage. */
export function canvasEntityElement(
	root: Element,
	key: EntityKey,
): HTMLElement | SVGElement | undefined {
	for (const element of root.querySelectorAll<HTMLElement | SVGElement>(ENTITY_SELECTOR)) {
		if (element.getAttribute('data-canvas-entity-key') === key) return element;
	}
	return undefined;
}

/** Moves focus onto an entity, which is how a deferred focus request is answered. */
export function focusCanvasEntity(root: Element, key: EntityKey): boolean {
	const element = canvasEntityElement(root, key);
	if (element === undefined) return false;
	element.focus();
	return true;
}

/** Scrolls the viewport by `delta`, smoothly unless the reader asked for reduced motion. */
export function scrollCanvasBy(viewport: Element, delta: CanvasPoint): void {
	if (delta.x === 0 && delta.y === 0) return;
	const reduced =
		viewport.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ===
		true;
	let behavior: ScrollBehavior = 'smooth';
	if (reduced) behavior = 'auto';
	viewport.scrollBy({ left: delta.x, top: delta.y, behavior });
}

/** The box enclosing a selection, which is what a floating bar is anchored to. */
export function canvasSelectionBounds(
	root: Element,
	keys: ReadonlySet<string>,
): DOMRect | undefined {
	const boxes = [...root.querySelectorAll<HTMLElement | SVGElement>(ENTITY_SELECTOR)]
		.filter((element) => keys.has(element.getAttribute('data-canvas-entity-key') ?? ''))
		.map((element) => element.getBoundingClientRect());
	if (boxes.length === 0) return undefined;
	const left = Math.min(...boxes.map((box) => box.left));
	const top = Math.min(...boxes.map((box) => box.top));
	const right = Math.max(...boxes.map((box) => box.right));
	const bottom = Math.max(...boxes.map((box) => box.bottom));
	return new DOMRect(left, top, right - left, bottom - top);
}
